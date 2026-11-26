"""The real app wired end to end: A2A worker lifespan, gateway dispatch with
fallback, and the context engine provider, against the registered agents.

The gateway and the context engine are httpx MockTransport handlers; Redis is
fakeredis. Nothing touches the network."""

import asyncio
import json
from datetime import UTC, datetime
from uuid import uuid4

import fakeredis
import httpx
import pytest
from app.a2a import agent_channel, reply_channel
from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient
from helix_agent_analytics.testing import FakeAnalyticsEngine, orders_data_source
from helix_agent_coordinator import RecordingProgressReporter
from helix_contracts import AgentType, AssembledContext, InvestigationRunResult

DOMAIN = ["ANALYTICS", "FINANCE", "CUSTOMER", "PRODUCT"]


def _settings(**env):
    return Settings(**{"CONTEXT_ENGINE_URL": "", "HELIX_A2A_MODE": "gateway", **env})


def _run_body():
    return {
        "investigation": {
            "id": str(uuid4()),
            "organizationId": str(uuid4()),
            "projectId": str(uuid4()),
            "question": "Why did revenue drop last week?",
            "triggerType": "USER_QUESTION",
        },
        "dataSources": [orders_data_source(str(uuid4()))],
    }


def _fake_gateway(redis):
    """Behaves like services/a2a-gateway POST /messages/request over `redis`."""

    async def handler(request: httpx.Request) -> httpx.Response:
        message = json.loads(request.content)
        pubsub = redis.pubsub()
        await pubsub.subscribe(reply_channel(message["correlationId"]))
        try:
            if await redis.publish(agent_channel(message["toAgent"]), json.dumps(message)) == 0:
                return httpx.Response(
                    503, json={"error": f"no agent listening for {message['toAgent']}"}
                )
            deadline = asyncio.get_running_loop().time() + 30
            while asyncio.get_running_loop().time() < deadline:
                raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if raw and raw["type"] == "message":
                    reply = json.loads(raw["data"])
                    return httpx.Response(200, json={
                        "request": message, "reply": reply, "routedAt": "t0", "repliedAt": "t1",
                    })
            return httpx.Response(504, json={"error": "timeout"})
        finally:
            await pubsub.aclose()

    return httpx.MockTransport(handler)


def _transports(result):
    return [t["result"].get("transport") for t in result["tasks"]
            if isinstance(t.get("result"), dict) and t["agentType"] != "COORDINATOR"]


def test_lifespan_starts_and_stops_worker():
    server = fakeredis.FakeServer()
    app = create_app(_settings(), redis=fakeredis.FakeAsyncRedis(server=server,
                                                                  decode_responses=True),
                     progress=RecordingProgressReporter(), llm=None)
    with TestClient(app) as client:
        a2a = client.get("/health").json()["a2a"]
        assert a2a["mode"] == "gateway" and a2a["workerRunning"] is True
        assert sorted(a2a["channels"]) == sorted(agent_channel(t) for t in DOMAIN)
    assert app.state.a2a_worker is None


def test_no_worker_when_redis_unreachable():
    app = create_app(_settings(REDIS_URL="redis://127.0.0.1:1"),
                     progress=RecordingProgressReporter(), llm=None)
    with TestClient(app) as client:
        assert client.get("/health").json()["a2a"]["workerRunning"] is False


def test_inprocess_mode_never_starts_worker():
    server = fakeredis.FakeServer()
    app = create_app(_settings(HELIX_A2A_MODE="inprocess"),
                     redis=fakeredis.FakeAsyncRedis(server=server), llm=None)
    with TestClient(app) as client:
        assert client.get("/health").json()["a2a"]["workerRunning"] is False


def test_investigation_tasks_travel_over_the_gateway():
    server = fakeredis.FakeServer()
    engine = FakeAnalyticsEngine()
    worker_redis = fakeredis.FakeAsyncRedis(server=server, decode_responses=True)
    gateway_redis = fakeredis.FakeAsyncRedis(server=server, decode_responses=True)
    app = create_app(_settings(), engine_transport=engine.transport,
                     progress=RecordingProgressReporter(), redis=worker_redis,
                     gateway_transport=_fake_gateway(gateway_redis), llm=None)
    with TestClient(app) as client:
        response = client.post("/investigations/run", json=_run_body())
    assert response.status_code == 200
    data = response.json()
    InvestigationRunResult.model_validate(data)
    transports = _transports(data)
    assert transports and set(transports) == {"a2a-gateway"}
    types = {m["type"] for m in data["messages"]}
    assert {"TASK_REQUEST"} <= types and types & {"TASK_RESULT", "ERROR"}


def test_gateway_down_falls_back_in_process():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    engine = FakeAnalyticsEngine()
    app = create_app(_settings(), engine_transport=engine.transport,
                     progress=RecordingProgressReporter(),
                     gateway_transport=httpx.MockTransport(refuse), llm=None)
    data = TestClient(app).post("/investigations/run", json=_run_body()).json()
    InvestigationRunResult.model_validate(data)
    transports = _transports(data)
    assert transports
    assert all(t.startswith("in-process (gateway unavailable: unreachable") for t in transports)
    assert any(t["status"] == "SUCCEEDED" for t in data["tasks"])


def _context_engine(calls):
    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        inv = body["investigation"]
        ctx = AssembledContext(
            context_id=uuid4(),
            assembled_at=datetime.now(UTC),
            agent_type=body["agentType"],
            agent_task_id=body["agentTaskId"],
            question=inv["question"],
            investigation_id=inv["id"],
            organization_id=inv["organizationId"],
            project_id=inv["projectId"],
            trigger_type=inv.get("triggerType", "USER_QUESTION"),
            step=body["step"],
            data_sources=body["dataSources"],
            token_count=42,
        )
        return httpx.Response(200, json=ctx.model_dump(mode="json", by_alias=True))

    return httpx.MockTransport(handler)


def test_contexts_come_from_the_context_engine():
    calls: list[dict] = []
    engine = FakeAnalyticsEngine()
    app = create_app(
        _settings(CONTEXT_ENGINE_URL="http://ctx.test", HELIX_A2A_MODE="inprocess"),
        engine_transport=engine.transport, progress=RecordingProgressReporter(),
        context_transport=_context_engine(calls), llm=None,
    )
    data = TestClient(app).post("/investigations/run", json=_run_body()).json()
    assert calls, "the Coordinator never asked the context engine"
    domain = [s for s in data["contextSnapshots"] if s["agentType"] != "COORDINATOR"]
    assert domain and all(s["assembledContext"]["source"] == "context-engine" for s in domain)
    assert {c["agentType"] for c in calls} <= set(DOMAIN)


def test_context_engine_down_falls_back():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    engine = FakeAnalyticsEngine()
    app = create_app(
        _settings(CONTEXT_ENGINE_URL="http://ctx.test", HELIX_A2A_MODE="inprocess"),
        engine_transport=engine.transport, progress=RecordingProgressReporter(),
        context_transport=httpx.MockTransport(refuse), llm=None,
    )
    data = TestClient(app).post("/investigations/run", json=_run_body()).json()
    assert data["status"] in ("COMPLETED", "PARTIALLY_COMPLETED")
    domain = [s for s in data["contextSnapshots"] if s["agentType"] != "COORDINATOR"]
    assert domain and all(s["assembledContext"]["source"] == "fallback" for s in domain)


@pytest.mark.parametrize("mode", ["gateway", "inprocess"])
def test_coordinator_gets_registry_wiring(mode):
    app = create_app(_settings(HELIX_A2A_MODE=mode), llm=None)
    registry = app.state.runtime.registry
    coordinator = registry[AgentType.COORDINATOR]
    assert {t.value for t in coordinator.available_agents} == set(DOMAIN)
    for agent_type in coordinator.available_agents:
        assert coordinator._requirements[agent_type] == registry[agent_type].context_requirements
