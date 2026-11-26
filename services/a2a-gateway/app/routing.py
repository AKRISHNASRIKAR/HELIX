"""Request/reply routing over Redis pub/sub (build spec 6.2).

Channels (agent-runtime's A2A worker uses the same names):

- `helix:a2a:agent:{AGENT_TYPE}`: TASK_REQUEST messages for one agent type;
  every agent-runtime worker hosting that type subscribes here.
- `helix:a2a:reply:{correlationId}`: the single TASK_RESULT or ERROR reply.

The gateway subscribes to the reply channel BEFORE publishing the request, so
a fast agent can never answer into the void. PUBLISH returns the number of
subscribers that received the message; 0 means nobody hosts that agent type.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from redis.asyncio import Redis

AGENT_CHANNEL = "helix:a2a:agent:{agent_type}"
REPLY_CHANNEL = "helix:a2a:reply:{correlation_id}"
REPLY_TYPES = ("TASK_RESULT", "ERROR")


def agent_channel(agent_type: str) -> str:
    return AGENT_CHANNEL.format(agent_type=agent_type)


def reply_channel(correlation_id: str) -> str:
    return REPLY_CHANNEL.format(correlation_id=correlation_id)


class NoListenerError(Exception):
    """Nobody is subscribed to the target agent's channel."""


class ReplyTimeoutError(Exception):
    """No reply arrived on the reply channel in time."""


async def request_reply(redis: Redis, message: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    """Publish `message` to its agent channel and wait for the correlated reply."""
    pubsub = redis.pubsub()
    reply_to = reply_channel(str(message["correlationId"]))
    await pubsub.subscribe(reply_to)
    try:
        listeners = await redis.publish(agent_channel(str(message["toAgent"])), json.dumps(message))
        if listeners == 0:
            raise NoListenerError(f"no agent listening for {message['toAgent']}")
        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ReplyTimeoutError(
                    f"no reply from {message['toAgent']} within {timeout_s:g}s"
                )
            raw = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=min(remaining, 1.0)
            )
            if raw is None or raw.get("type") != "message":
                await asyncio.sleep(0)
                continue
            try:
                reply = json.loads(raw["data"])
            except (TypeError, ValueError):
                continue  # garbage on our private channel; keep waiting
            if isinstance(reply, dict) and reply.get("type") in REPLY_TYPES:
                return reply
    finally:
        try:
            await pubsub.unsubscribe(reply_to)
        finally:
            await pubsub.aclose()
