"""Agent-to-agent transport for agent-runtime (build spec 6.2 / 6.3).

Two halves of the same request/reply exchange over services/a2a-gateway:

- GatewayDispatch (the Coordinator's dispatch hook in `gateway` mode) wraps a
  task in a TASK_REQUEST AgentMessage and POSTs it to the gateway, which
  publishes it on `helix:a2a:agent:{TYPE}` and waits on
  `helix:a2a:reply:{correlationId}`. When the gateway is unreachable, answers
  503 (no listener, Redis down) or anything else unusable, the task runs
  in-process instead, so an investigation never stops because of the transport.
- A2AWorker subscribes to `helix:a2a:agent:{TYPE}` for every hosted domain
  agent, runs each TASK_REQUEST through the runtime and publishes the
  TASK_RESULT (or ERROR) to the reply channel.

Every dispatched task that comes back with a dict result carries
`result["transport"]` ("a2a-gateway", "in-process" or
"in-process (gateway unavailable: ...)") so the Coordinator can record how the
task travelled. Known limitation: Redis pub/sub fans out, so two runtime
replicas hosting the same agent type would both run a request; the first reply
wins at the gateway. A stream/queue transport can replace this later without
changing the AgentMessage shape.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, Protocol
from uuid import uuid4

import httpx
from helix_contracts import AgentMessageType, AgentTask, AgentTaskStatus, AgentType
from pydantic import ValidationError
from redis.asyncio import Redis

from .runtime import failed_task

logger = logging.getLogger(__name__)

AGENT_CHANNEL = "helix:a2a:agent:{agent_type}"
REPLY_CHANNEL = "helix:a2a:reply:{correlation_id}"

TRANSPORT_GATEWAY = "a2a-gateway"
TRANSPORT_IN_PROCESS = "in-process"

#: The Coordinator's dispatch hook.
Dispatch = Callable[[AgentTask], Awaitable[AgentTask]]


def agent_channel(agent_type: AgentType | str) -> str:
    return AGENT_CHANNEL.format(agent_type=AgentType(agent_type).value)


def reply_channel(correlation_id: str) -> str:
    return REPLY_CHANNEL.format(correlation_id=correlation_id)


class TaskRunner(Protocol):
    """What the transport needs from AgentRuntime: run a task, never raise."""

    async def run(self, task: AgentTask) -> AgentTask: ...


def mark_transport(task: AgentTask, transport: str) -> AgentTask:
    """Record how the task travelled (only when the result is a dict)."""
    if isinstance(task.result, dict):
        task.result["transport"] = transport
    return task


def task_request_message(task: AgentTask) -> dict[str, Any]:
    """The TASK_REQUEST AgentMessage for `task` (correlationId = task id)."""
    return {
        "id": str(uuid4()),
        "type": AgentMessageType.TASK_REQUEST.value,
        "investigationId": str(task.investigation_id),
        "agentTaskId": str(task.id),
        "fromAgent": AgentType.COORDINATOR.value,
        "toAgent": task.agent_type.value,
        "payload": {"task": task.model_dump(mode="json", by_alias=True)},
        "correlationId": str(task.id),
    }


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


class InProcessDispatch:
    """`inprocess` mode: run the task directly on this runtime."""

    def __init__(self, runner: TaskRunner):
        self.runner = runner

    async def __call__(self, task: AgentTask) -> AgentTask:
        return mark_transport(await self.runner.run(task), TRANSPORT_IN_PROCESS)


class GatewayDispatch:
    """`gateway` mode: route through services/a2a-gateway, fall back to in-process."""

    def __init__(
        self,
        runner: TaskRunner,
        gateway_url: str,
        *,
        reply_margin_ms: int = 5_000,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.runner = runner
        self.gateway_url = gateway_url.rstrip("/")
        self.reply_margin_ms = reply_margin_ms
        self._transport = transport

    async def __call__(self, task: AgentTask) -> AgentTask:
        # The worker enforces task.timeoutMs itself and replies TIMED_OUT, so the
        # gateway waits a little longer than that and the HTTP call longer still.
        wait_ms = task.timeout_ms + self.reply_margin_ms
        message = task_request_message(task)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(wait_ms / 1000 + 5, connect=5.0), transport=self._transport
            ) as client:
                response = await client.post(
                    f"{self.gateway_url}/messages/request",
                    params={"timeoutMs": wait_ms},
                    json=message,
                )
        except httpx.ConnectError as exc:
            return await self._fallback(task, f"unreachable: {exc}")
        except httpx.ConnectTimeout:
            return await self._fallback(task, "connect timeout")
        except httpx.TimeoutException:
            # The request reached the gateway and may be running; do not run it twice.
            return failed_task(
                task, f"No reply via the A2A gateway within {wait_ms / 1000:g}s.",
                AgentTaskStatus.TIMED_OUT,
            )
        except httpx.HTTPError as exc:
            return await self._fallback(task, f"{type(exc).__name__}: {exc}")

        if response.status_code == 504:
            return failed_task(
                task, f"No reply via the A2A gateway within {wait_ms / 1000:g}s.",
                AgentTaskStatus.TIMED_OUT,
            )
        if response.status_code != 200:
            return await self._fallback(task, f"HTTP {response.status_code}: {_error_of(response)}")
        try:
            reply = response.json()["reply"]
            payload = reply.get("payload") or {}
            if "task" in payload:
                done = AgentTask.model_validate(payload["task"])
            else:
                error = payload.get("error") or "Agent replied with an ERROR."
                done = failed_task(task, str(error))
        except (ValueError, KeyError, TypeError, AttributeError, ValidationError) as exc:
            logger.warning("Malformed A2A reply for task %s: %s", task.id, exc)
            return failed_task(task, f"Malformed reply from the A2A gateway: {exc}")
        return mark_transport(done, TRANSPORT_GATEWAY)

    async def _fallback(self, task: AgentTask, reason: str) -> AgentTask:
        logger.warning("A2A gateway unavailable for task %s (%s); running in-process",
                       task.id, reason)
        done = await self.runner.run(task)
        return mark_transport(done, f"{TRANSPORT_IN_PROCESS} (gateway unavailable: {reason})")


def _error_of(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(body, dict):
        error = body.get("error") or body.get("detail") or body
        return str(error)[:200]
    return str(body)[:200]


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


class A2AWorker:
    """Serve TASK_REQUESTs for `agent_types` from Redis pub/sub."""

    def __init__(self, runner: TaskRunner, redis: Redis, agent_types: Iterable[AgentType]):
        self.runner = runner
        self.redis = redis
        self.agent_types = [AgentType(t) for t in agent_types]
        self.channels = [agent_channel(t) for t in self.agent_types]
        self._pubsub = None
        self._loop_task: asyncio.Task | None = None
        self._handlers: set[asyncio.Task] = set()

    @property
    def running(self) -> bool:
        return self._loop_task is not None and not self._loop_task.done()

    async def start(self) -> None:
        if not self.channels:
            return
        self._pubsub = self.redis.pubsub()
        await self._pubsub.subscribe(*self.channels)
        self._loop_task = asyncio.create_task(self._listen(), name="a2a-worker")
        logger.info("A2A worker subscribed to %s", ", ".join(self.channels))

    async def stop(self) -> None:
        if self._loop_task is not None:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
            self._loop_task = None
        for handler in list(self._handlers):
            handler.cancel()
        if self._handlers:
            await asyncio.gather(*self._handlers, return_exceptions=True)
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.unsubscribe()
            with contextlib.suppress(Exception):
                await self._pubsub.aclose()
            self._pubsub = None

    async def _listen(self) -> None:
        assert self._pubsub is not None
        while True:
            try:
                raw = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            except asyncio.CancelledError:
                raise
            except Exception:  # connection hiccup: keep serving, do not spin
                logger.exception("A2A worker failed to read from Redis")
                await asyncio.sleep(1.0)
                continue
            if raw is None or raw.get("type") != "message":
                continue
            # Each request runs in its own task so concurrent plan steps run concurrently.
            handler = asyncio.create_task(self.handle(raw["data"]))
            self._handlers.add(handler)
            handler.add_done_callback(self._handlers.discard)

    async def handle(self, raw: str | bytes) -> dict[str, Any] | None:
        """Handle one raw message; returns the reply it published (None if ignored)."""
        try:
            message = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("A2A worker ignored a non-JSON message")
            return None
        if not isinstance(message, dict) or message.get("type") != "TASK_REQUEST":
            return None
        correlation_id = message.get("correlationId")
        if not correlation_id:
            logger.warning("A2A worker ignored a TASK_REQUEST without correlationId")
            return None

        task_json = (message.get("payload") or {}).get("task")
        try:
            task = AgentTask.model_validate(task_json)
        except ValidationError as exc:
            reply = self._reply(message, AgentMessageType.ERROR, {"error": f"invalid task: {exc}"})
        else:
            done = await self.runner.run(task)
            payload: dict[str, Any] = {"task": done.model_dump(mode="json", by_alias=True)}
            if done.status == AgentTaskStatus.SUCCEEDED:
                reply = self._reply(message, AgentMessageType.TASK_RESULT, payload)
            else:
                payload["error"] = done.error
                reply = self._reply(message, AgentMessageType.ERROR, payload)
        try:
            await self.redis.publish(reply_channel(str(correlation_id)), json.dumps(reply))
        except Exception:
            logger.exception("A2A worker could not publish the reply for %s", correlation_id)
        return reply

    @staticmethod
    def _reply(
        request: dict[str, Any], type_: AgentMessageType, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "id": str(uuid4()),
            "type": type_.value,
            "investigationId": request.get("investigationId"),
            "agentTaskId": request.get("agentTaskId"),
            "fromAgent": request.get("toAgent"),
            "toAgent": request.get("fromAgent") or AgentType.COORDINATOR.value,
            "payload": payload,
            "correlationId": request.get("correlationId"),
        }
