"""Transport tests with stub agents (no agents/* packages needed).

Covers GatewayDispatch (gateway path, fallback, timeouts), InProcessDispatch,
and the A2A worker, including a full round trip where a fake gateway (an
httpx MockTransport handler) routes over fakeredis to a real A2AWorker.
"""

import asyncio
import json
from uuid import uuid4

import fakeredis
import httpx
import pytest
from app.a2a import (
    A2AWorker,
    GatewayDispatch,
    InProcessDispatch,
    agent_channel,
    reply_channel,
    task_request_message,
)
from app.runtime import AgentRuntime
from helix_contracts import (
    AgentCapability,
    AgentTask,
    AgentTaskStatus,
    AgentType,
    BaseAgent,
    ContextRequirements,
)


class StubAgent(BaseAgent):
    """Echoes its objective; `fail=True` reports a failed task, `delay` sleeps first."""

    name = "Stub"
    context_requirements = ContextRequirements(table_keywords=["order"])

    def __init__(self, agent_type: AgentType, *, fail=False, delay=0.0, raise_=False):
        self.agent_type = agent_type
        self.fail = fail
        self.delay = delay
        self.raise_ = raise_
        self.calls = 0

    @property
    def capabilities(self):
        return [AgentCapability(name="echo", description="echo")]

    async def execute(self, task: AgentTask) -> AgentTask:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.raise_:
            raise RuntimeError("boom")
        done = task.model_copy(deep=True)
        if self.fail:
            done.status = AgentTaskStatus.FAILED
            done.error = "stub failure"
            return done
        done.status = AgentTaskStatus.SUCCEEDED
        done.result = {"findings": [], "echo": task.objective}
        return done


def _runtime(*agents):
    runtime = AgentRuntime()
    for agent in agents or (StubAgent(AgentType.FINANCE),):
        runtime.register(agent)
    return runtime


def _task(agent_type=AgentType.FINANCE, timeout_ms=5_000):
    return AgentTask.model_validate({
        "id": str(uuid4()),
        "investigationId": str(uuid4()),
        "agentType": agent_type.value,
        "status": "QUEUED",
        "objective": "explain refunds",
        "inputContext": {"question": "q"},
        "timeoutMs": timeout_ms,
    })


def _redis(server):
    return fakeredis.FakeAsyncRedis(server=server, decode_responses=True)


# ---------------------------------------------------------------------------
# Messages / in-process
# ---------------------------------------------------------------------------


def test_task_request_message_shape():
    task = _task()
    message = task_request_message(task)
    assert message["type"] == "TASK_REQUEST"
    assert message["fromAgent"] == "COORDINATOR" and message["toAgent"] == "FINANCE"
    assert message["correlationId"] == str(task.id) == message["agentTaskId"]
    assert message["investigationId"] == str(task.investigation_id)
    assert AgentTask.model_validate(message["payload"]["task"]) == task
    json.dumps(message)


@pytest.mark.asyncio
async def test_in_process_dispatch_marks_transport():
    done = await InProcessDispatch(_runtime())(_task())
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.result["transport"] == "in-process"


@pytest.mark.asyncio
async def test_failed_task_without_result_is_not_marked():
    runtime = _runtime(StubAgent(AgentType.FINANCE, raise_=True))
    done = await InProcessDispatch(runtime)(_task())
    assert done.status == AgentTaskStatus.FAILED and done.result is None


def test_runtime_lists_domain_agent_types():
    runtime = _runtime(StubAgent(AgentType.COORDINATOR), StubAgent(AgentType.FINANCE),
                       StubAgent(AgentType.PRODUCT))
    assert runtime.domain_agent_types == [AgentType.FINANCE, AgentType.PRODUCT]


# ---------------------------------------------------------------------------
# GatewayDispatch with a mocked gateway
# ---------------------------------------------------------------------------


class FakeGateway:
    """MockTransport handler that answers like services/a2a-gateway.

    mode: "ok" runs the task on `remote` and replies, "down" refuses connections,
    "503" has no listener, "504" times out, "error-reply" replies ERROR without task,
    "garbage" returns a non-JSON body, "500" fails."""

    def __init__(self, mode="ok", remote: AgentRuntime | None = None):
        self.mode = mode
        self.remote = remote or _runtime()
        self.requests: list[httpx.Request] = []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.mode == "down":
            raise httpx.ConnectError("connection refused", request=request)
        if self.mode == "read-timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if self.mode == "503":
            return httpx.Response(503, json={"error": "no agent listening for FINANCE"})
        if self.mode == "504":
            return httpx.Response(504, json={"error": "no reply"})
        if self.mode == "500":
            return httpx.Response(500, text="Internal Server Error")
        if self.mode == "garbage":
            return httpx.Response(200, text="nope")
        message = json.loads(request.content)
        if self.mode == "error-reply":
            payload = {"error": "invalid task"}
        else:
            done = await self.remote.run(AgentTask.model_validate(message["payload"]["task"]))
            payload = {"task": done.model_dump(mode="json", by_alias=True)}
        reply = {"type": "TASK_RESULT" if self.mode == "ok" else "ERROR", "payload": payload,
                 "correlationId": message["correlationId"]}
        return httpx.Response(200, json={"request": message, "reply": reply,
                                         "routedAt": "t0", "repliedAt": "t1"})

    @property
    def transport(self):
        return httpx.MockTransport(self.handler)


@pytest.mark.asyncio
async def test_gateway_dispatch_routes_through_gateway():
    local = StubAgent(AgentType.FINANCE)
    remote_agent = StubAgent(AgentType.FINANCE)
    gateway = FakeGateway(remote=_runtime(remote_agent))
    dispatch = GatewayDispatch(_runtime(local), "http://gw.test/", transport=gateway.transport,
                               reply_margin_ms=1_000)
    task = _task(timeout_ms=4_000)
    done = await dispatch(task)

    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.result["transport"] == "a2a-gateway"
    assert done.result["echo"] == "explain refunds"
    assert remote_agent.calls == 1 and local.calls == 0
    sent = gateway.requests[0]
    assert sent.url.path == "/messages/request"
    assert sent.url.params["timeoutMs"] == "5000"
    body = json.loads(sent.content)
    assert body["type"] == "TASK_REQUEST" and body["correlationId"] == str(task.id)


@pytest.mark.asyncio
@pytest.mark.parametrize(("mode", "reason"), [
    ("down", "unreachable"),
    ("503", "HTTP 503: no agent listening for FINANCE"),
    ("500", "HTTP 500"),
])
async def test_gateway_dispatch_falls_back_in_process(mode, reason):
    local = StubAgent(AgentType.FINANCE)
    gateway = FakeGateway(mode)
    done = await GatewayDispatch(_runtime(local), "http://gw.test", transport=gateway.transport)(
        _task()
    )
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert local.calls == 1
    assert done.result["transport"].startswith("in-process (gateway unavailable: ")
    assert reason in done.result["transport"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["504", "read-timeout"])
async def test_gateway_timeout_is_timed_out_not_rerun(mode):
    local = StubAgent(AgentType.FINANCE)
    gateway = FakeGateway(mode)
    done = await GatewayDispatch(_runtime(local), "http://gw.test", transport=gateway.transport)(
        _task()
    )
    assert done.status == AgentTaskStatus.TIMED_OUT
    assert local.calls == 0
    assert "A2A gateway" in done.error


@pytest.mark.asyncio
async def test_gateway_error_reply_and_garbage_become_failed_tasks():
    for mode, text in (("error-reply", "invalid task"), ("garbage", "Malformed reply")):
        local = StubAgent(AgentType.FINANCE)
        gateway = FakeGateway(mode)
        done = await GatewayDispatch(_runtime(local), "http://gw.test",
                                     transport=gateway.transport)(_task())
        assert done.status == AgentTaskStatus.FAILED
        assert text in done.error
        assert local.calls == 0


@pytest.mark.asyncio
async def test_gateway_relays_remote_failure_as_is():
    remote = _runtime(StubAgent(AgentType.FINANCE, fail=True))
    gateway = FakeGateway("ok", remote=remote)
    done = await GatewayDispatch(_runtime(), "http://gw.test", transport=gateway.transport)(
        _task()
    )
    assert done.status == AgentTaskStatus.FAILED and done.error == "stub failure"


# ---------------------------------------------------------------------------
# A2A worker over fakeredis
# ---------------------------------------------------------------------------


async def _await_reply(pubsub, timeout=3.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
        if raw and raw["type"] == "message":
            return json.loads(raw["data"])
    raise AssertionError("no reply")


@pytest.mark.asyncio
async def test_worker_handles_request_and_publishes_result():
    server = fakeredis.FakeServer()
    worker = A2AWorker(_runtime(), _redis(server), [AgentType.FINANCE])
    await worker.start()
    client = _redis(server)
    try:
        assert worker.running
        assert dict(await client.pubsub_numsub(agent_channel("FINANCE")))[
            agent_channel("FINANCE")
        ] == 1
        task = _task()
        message = task_request_message(task)
        replies = client.pubsub()
        await replies.subscribe(reply_channel(message["correlationId"]))
        assert await client.publish(agent_channel("FINANCE"), json.dumps(message)) == 1
        reply = await _await_reply(replies)
        await replies.aclose()
    finally:
        await worker.stop()
    assert not worker.running
    assert reply["type"] == "TASK_RESULT"
    assert reply["fromAgent"] == "FINANCE" and reply["toAgent"] == "COORDINATOR"
    assert reply["correlationId"] == str(task.id)
    assert reply["payload"]["task"]["status"] == "SUCCEEDED"
    assert reply["payload"]["task"]["result"]["echo"] == "explain refunds"
    # stop() unsubscribed
    assert dict(await client.pubsub_numsub(agent_channel("FINANCE")))[
        agent_channel("FINANCE")
    ] == 0


@pytest.mark.asyncio
async def test_worker_replies_error_for_failed_and_invalid_tasks():
    server = fakeredis.FakeServer()
    worker = A2AWorker(_runtime(StubAgent(AgentType.FINANCE, fail=True)), _redis(server),
                       [AgentType.FINANCE])
    failed = await worker.handle(json.dumps(task_request_message(_task())))
    assert failed["type"] == "ERROR"
    assert failed["payload"]["error"] == "stub failure"
    assert failed["payload"]["task"]["status"] == "FAILED"

    bad = {**task_request_message(_task()), "payload": {"task": {"id": "nope"}}}
    invalid = await worker.handle(json.dumps(bad))
    assert invalid["type"] == "ERROR" and "invalid task" in invalid["payload"]["error"]
    assert "task" not in invalid["payload"]


@pytest.mark.asyncio
async def test_worker_ignores_noise():
    worker = A2AWorker(_runtime(), _redis(fakeredis.FakeServer()), [AgentType.FINANCE])
    assert await worker.handle("not json") is None
    assert await worker.handle(json.dumps({"type": "TASK_RESULT"})) is None
    no_corr = {**task_request_message(_task()), "correlationId": None}
    assert await worker.handle(json.dumps(no_corr)) is None


@pytest.mark.asyncio
async def test_worker_runs_requests_concurrently():
    server = fakeredis.FakeServer()
    runtime = _runtime(StubAgent(AgentType.FINANCE, delay=0.3),
                       StubAgent(AgentType.CUSTOMER, delay=0.3))
    worker = A2AWorker(runtime, _redis(server), runtime.domain_agent_types)
    await worker.start()
    client = _redis(server)
    try:
        tasks = [_task(AgentType.FINANCE), _task(AgentType.CUSTOMER)]
        subs = []
        for task in tasks:
            pubsub = client.pubsub()
            await pubsub.subscribe(reply_channel(str(task.id)))
            subs.append(pubsub)
        start = asyncio.get_running_loop().time()
        for task in tasks:
            await client.publish(agent_channel(task.agent_type), json.dumps(
                task_request_message(task)))
        replies = await asyncio.gather(*(_await_reply(p) for p in subs))
        elapsed = asyncio.get_running_loop().time() - start
        for pubsub in subs:
            await pubsub.aclose()
    finally:
        await worker.stop()
    assert {r["fromAgent"] for r in replies} == {"FINANCE", "CUSTOMER"}
    assert elapsed < 0.55  # both ran at once, not 0.6s back to back


@pytest.mark.asyncio
async def test_round_trip_gateway_dispatch_to_worker_over_redis():
    """GatewayDispatch -> fake gateway (subscribe reply, publish request, wait, like
    services/a2a-gateway) -> fakeredis -> A2AWorker -> runtime -> reply."""
    server = fakeredis.FakeServer()
    remote_agent = StubAgent(AgentType.PRODUCT)
    worker = A2AWorker(_runtime(remote_agent), _redis(server), [AgentType.PRODUCT])
    await worker.start()
    gw_redis = _redis(server)

    async def gateway(request: httpx.Request) -> httpx.Response:
        message = json.loads(request.content)
        pubsub = gw_redis.pubsub()
        await pubsub.subscribe(reply_channel(message["correlationId"]))
        listeners = await gw_redis.publish(agent_channel(message["toAgent"]),
                                           json.dumps(message))
        if listeners == 0:
            await pubsub.aclose()
            return httpx.Response(503, json={"error": f"no agent listening for "
                                                      f"{message['toAgent']}"})
        reply = await _await_reply(pubsub)
        await pubsub.aclose()
        return httpx.Response(200, json={"request": message, "reply": reply,
                                         "routedAt": "t0", "repliedAt": "t1"})

    local = StubAgent(AgentType.PRODUCT)
    dispatch = GatewayDispatch(_runtime(local), "http://gw.test",
                               transport=httpx.MockTransport(gateway))
    try:
        done = await dispatch(_task(AgentType.PRODUCT))
        # No worker for FINANCE: the gateway answers 503 and dispatch falls back.
        fallback = await GatewayDispatch(_runtime(StubAgent(AgentType.FINANCE)), "http://gw.test",
                                         transport=httpx.MockTransport(gateway))(_task())
    finally:
        await worker.stop()
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.result["transport"] == "a2a-gateway"
    assert remote_agent.calls == 1 and local.calls == 0
    assert fallback.result["transport"] == (
        "in-process (gateway unavailable: HTTP 503: no agent listening for FINANCE)"
    )
