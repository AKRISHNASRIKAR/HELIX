import asyncio
import contextlib
import json
import socket
from uuid import uuid4

import fakeredis
import httpx
import pytest
import redis.asyncio as aioredis
from app.config import Settings
from app.main import create_app
from app.routing import agent_channel, reply_channel


def _request_message(to_agent="FINANCE"):
    task_id = str(uuid4())
    return {
        "id": str(uuid4()),
        "type": "TASK_REQUEST",
        "investigationId": str(uuid4()),
        "agentTaskId": task_id,
        "fromAgent": "COORDINATOR",
        "toAgent": to_agent,
        "payload": {"task": {"id": task_id, "agentType": to_agent, "status": "QUEUED"}},
        "correlationId": task_id,
    }


async def _fake_agent(redis, agent_type, *, reply_type="TASK_RESULT", garbage_first=False,
                      ready: asyncio.Event):
    """Minimal stand-in for agent-runtime's A2A worker: answer one request."""
    pubsub = redis.pubsub()
    await pubsub.subscribe(agent_channel(agent_type))
    ready.set()
    try:
        while True:
            raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if raw is None:
                continue
            request = json.loads(raw["data"])
            task = {**request["payload"]["task"], "status": "SUCCEEDED", "result": {"ok": True}}
            channel = reply_channel(request["correlationId"])
            if garbage_first:
                await redis.publish(channel, "not json")
                await redis.publish(channel, json.dumps({"type": "STATUS_UPDATE"}))
            reply = {
                "id": str(uuid4()),
                "type": reply_type,
                "investigationId": request["investigationId"],
                "agentTaskId": request["agentTaskId"],
                "fromAgent": agent_type,
                "toAgent": "COORDINATOR",
                "payload": {"task": task},
                "correlationId": request["correlationId"],
            }
            await redis.publish(channel, json.dumps(reply))
            return
    finally:
        await pubsub.aclose()


@pytest.fixture
def server():
    return fakeredis.FakeServer()


def _redis(server):
    return fakeredis.FakeAsyncRedis(server=server, decode_responses=True)


@contextlib.asynccontextmanager
async def _client(redis):
    app = create_app(Settings(), redis=redis)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw") as client:
        yield client


@pytest.mark.asyncio
@pytest.mark.parametrize("reply_type", ["TASK_RESULT", "ERROR"])
async def test_request_is_routed_and_reply_returned(server, reply_type):
    ready = asyncio.Event()
    agent = asyncio.create_task(
        _fake_agent(_redis(server), "FINANCE", reply_type=reply_type, garbage_first=True,
                    ready=ready)
    )
    await ready.wait()
    message = _request_message()
    async with _client(_redis(server)) as client:
        response = await client.post("/messages/request?timeoutMs=5000", json=message)
    await agent
    assert response.status_code == 200
    body = response.json()
    assert body["request"]["correlationId"] == message["correlationId"]
    assert body["request"]["payload"] == message["payload"]
    assert body["reply"]["type"] == reply_type
    assert body["reply"]["payload"]["task"]["status"] == "SUCCEEDED"
    assert body["reply"]["correlationId"] == message["correlationId"]
    assert body["routedAt"].endswith("Z") and body["repliedAt"] >= body["routedAt"]


@pytest.mark.asyncio
async def test_no_listener_is_503(server):
    async with _client(_redis(server)) as client:
        response = await client.post("/messages/request", json=_request_message("PRODUCT"))
    assert response.status_code == 503
    assert response.json() == {"error": "no agent listening for PRODUCT"}


@pytest.mark.asyncio
async def test_silent_agent_is_504(server):
    listener = _redis(server).pubsub()
    await listener.subscribe(agent_channel("CUSTOMER"))
    try:
        async with _client(_redis(server)) as client:
            response = await client.post(
                "/messages/request?timeoutMs=200", json=_request_message("CUSTOMER")
            )
    finally:
        await listener.aclose()
    assert response.status_code == 504
    assert "no reply from CUSTOMER" in response.json()["error"]


@pytest.mark.asyncio
async def test_rejects_non_requests_and_bad_bodies(server):
    async with _client(_redis(server)) as client:
        result = {**_request_message(), "type": "TASK_RESULT"}
        assert (await client.post("/messages/request", json=result)).status_code == 422
        to_coord = _request_message("COORDINATOR")
        assert (await client.post("/messages/request", json=to_coord)).status_code == 422
        assert (await client.post("/messages/request", json={"type": "x"})).status_code == 422
        too_long = "/messages/request?timeoutMs=999999999"
        assert (await client.post(too_long, json=_request_message())).status_code == 422


@pytest.mark.asyncio
async def test_agents_lists_listener_counts(server):
    listeners = [_redis(server).pubsub() for _ in range(2)]
    await listeners[0].subscribe(agent_channel("FINANCE"), agent_channel("PRODUCT"))
    await listeners[1].subscribe(agent_channel("FINANCE"))
    try:
        async with _client(_redis(server)) as client:
            agents = (await client.get("/agents")).json()
    finally:
        for pubsub in listeners:
            await pubsub.aclose()
    counts = {a["agentType"]: a["listeners"] for a in agents}
    assert counts["FINANCE"] == 2 and counts["PRODUCT"] == 1 and counts["CUSTOMER"] == 0
    assert "COORDINATOR" in counts and len(counts) == 7


@pytest.mark.asyncio
async def test_health_reports_redis(server):
    async with _client(_redis(server)) as client:
        body = (await client.get("/health")).json()
    assert body == {"status": "ok", "service": "a2a-gateway", "redis": {"ok": True}}


@pytest.mark.asyncio
async def test_health_and_routing_when_redis_is_down():
    down = aioredis.from_url("redis://127.0.0.1:1", socket_connect_timeout=0.5)
    async with _client(down) as client:
        health = (await client.get("/health")).json()
        routed = await client.post("/messages/request", json=_request_message())
        agents = await client.get("/agents")
    assert health["status"] == "ok" and health["redis"]["ok"] is False
    assert routed.status_code == 503 and "redis unavailable" in routed.json()["error"]
    assert agents.status_code == 503


def test_settings_accept_global_redis_url(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://r:6379")
    assert Settings().redis_url == "redis://r:6379"


def _redis_reachable() -> bool:
    try:
        with socket.create_connection(("localhost", 6379), timeout=0.3):
            return True
    except OSError:
        return False


@pytest.mark.asyncio
@pytest.mark.skipif(not _redis_reachable(), reason="no local Redis on localhost:6379")
async def test_round_trip_through_real_redis():
    """Optional integration check against a real Redis (skipped when unreachable)."""
    agent_type = "VISUALIZATION"  # unlikely to collide with a running worker
    worker_redis = aioredis.from_url("redis://localhost:6379", decode_responses=True)
    gateway_redis = aioredis.from_url("redis://localhost:6379", decode_responses=True)
    ready = asyncio.Event()
    agent = asyncio.create_task(_fake_agent(worker_redis, agent_type, ready=ready))
    await ready.wait()
    try:
        async with _client(gateway_redis) as client:
            response = await client.post(
                "/messages/request?timeoutMs=5000", json=_request_message(agent_type)
            )
        await agent
    finally:
        await worker_redis.aclose()
        await gateway_redis.aclose()
    assert response.status_code == 200
    assert response.json()["reply"]["fromAgent"] == agent_type
