import json
from uuid import UUID, uuid4

import helix_agent_analytics
import httpx
import pytest
from app.config import Settings
from app.main import AGENT_REGISTRY, create_app
from app.progress import HttpProgressReporter
from fastapi.testclient import TestClient
from helix_agent_analytics.testing import FakeAnalyticsEngine, orders_data_source
from helix_agent_coordinator import RecordingProgressReporter
from helix_contracts import InvestigationRunResult


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


@pytest.fixture
def progress():
    return RecordingProgressReporter()


def _settings(**env):
    """Hermetic settings: no context engine, in-process dispatch unless overridden."""
    return Settings(**{"CONTEXT_ENGINE_URL": "", "HELIX_A2A_MODE": "inprocess", **env})


@pytest.fixture
def client(engine, progress):
    app = create_app(_settings(), engine_transport=engine.transport, progress=progress, llm=None)
    return TestClient(app)


def _run_body(question="Why did revenue drop last week?", data_sources=None):
    return {
        "investigation": {
            "id": str(uuid4()),
            "organizationId": str(uuid4()),
            "projectId": str(uuid4()),
            "question": question,
            "triggerType": "USER_QUESTION",
        },
        "dataSources": [orders_data_source(str(uuid4()))] if data_sources is None
        else data_sources,
    }


def _is_uuid4(value: str) -> bool:
    return UUID(value).version == 4


ALL_AGENTS = {"COORDINATOR", "ANALYTICS", "FINANCE", "CUSTOMER", "PRODUCT"}


def test_default_app_registers_every_agent():
    assert {t.value for t in AGENT_REGISTRY} == ALL_AGENTS


def test_health_counts_registered_agents(client):
    body = client.get("/health").json()
    assert body["registeredAgents"] == 5
    assert body["a2a"] == {"mode": "inprocess", "workerRunning": False, "channels": []}


def test_list_agents(client):
    agents = {a["type"]: a for a in client.get("/agents").json()}
    assert set(agents) == ALL_AGENTS
    for agent in agents.values():
        assert {"includeHistory", "maxTokens", "semanticTypes"} <= set(
            agent["contextRequirements"]
        )
    assert agents["PRODUCT"]["contextRequirements"]["dataSourceTypes"] == ["MCP", "GITHUB"]
    analytics = agents["ANALYTICS"]
    assert analytics["status"] == "IDLE"
    assert analytics["name"] == "Analytics Agent"
    assert analytics["version"] == helix_agent_analytics.__version__
    assert [c["name"] for c in analytics["capabilities"]] == [
        "kpi_analysis", "trend_analysis", "anomaly_detection", "forecasting",
    ]
    assert set(analytics["capabilities"][0]) == {"name", "description"}


def _analytics_task(org_id=None, data_sources=None):
    return {
        "id": str(uuid4()),
        "investigationId": str(uuid4()),
        "agentType": "ANALYTICS",
        "status": "QUEUED",
        "objective": "Why did revenue drop last week?",
        "inputContext": {
            "question": "Why did revenue drop last week?",
            "organizationId": org_id or str(uuid4()),
            "dataSources": [orders_data_source(str(uuid4()))] if data_sources is None
            else data_sources,
        },
    }


def test_execute_analytics_task(client, engine):
    response = client.post("/agents/ANALYTICS/execute", json=_analytics_task())
    assert response.status_code == 200
    task = response.json()
    assert task["status"] == "SUCCEEDED"
    assert task["error"] is None
    assert task["result"]["findings"]
    assert engine.paths()[:2] == ["/kpis", "/anomalies/detect"]


def test_execute_reports_engine_failure_as_failed_task(client, engine):
    engine.down = True
    response = client.post("/agents/ANALYTICS/execute", json=_analytics_task())
    assert response.status_code == 200
    task = response.json()
    assert task["status"] == "FAILED"
    assert "unreachable" in task["error"]


def test_execute_rejects_mismatched_or_unknown_agent(client):
    assert client.post("/agents/COORDINATOR/execute", json=_analytics_task()).status_code == 422
    assert client.post("/agents/OPERATIONS/execute", json=_analytics_task()).status_code == 404
    assert client.post("/agents/NOPE/execute", json=_analytics_task()).status_code == 422


def test_run_investigation_returns_valid_linked_result(client, progress):
    body = _run_body()
    response = client.post("/investigations/run", json=body)
    assert response.status_code == 200
    data = response.json()
    InvestigationRunResult.model_validate(data)

    assert data["status"] in ("COMPLETED", "PARTIALLY_COMPLETED")
    # Multi-agent plan (CSV only, so no PRODUCT): analytics first, synthesis last.
    plan_types = [s["agentType"] for s in data["plan"]["steps"]]
    assert plan_types[0] == "ANALYTICS" and plan_types[-1] == "COORDINATOR"
    assert {"FINANCE", "CUSTOMER"} <= set(plan_types) and "PRODUCT" not in plan_types
    assert len(data["contextSnapshots"]) == len(data["tasks"])
    assert all(t["result"]["transport"] == "in-process" for t in data["tasks"]
               if t["agentType"] != "COORDINATOR" and isinstance(t["result"], dict))

    for key in ("steps", "tasks", "evidence", "findings", "recommendations", "metrics",
                "anomalies"):
        for item in data[key]:
            assert _is_uuid4(item["id"]), (key, item["id"])

    step_ids = {s["id"] for s in data["steps"]}
    task_ids = {t["id"] for t in data["tasks"]}
    evidence_ids = {e["id"] for e in data["evidence"]}
    finding_ids = {f["id"] for f in data["findings"]}
    metric_ids = {m["id"] for m in data["metrics"]}
    anomaly_ids = {a["id"] for a in data["anomalies"]}

    assert all(t["stepId"] in step_ids for t in data["tasks"])
    assert all(e["agentTaskId"] in task_ids for e in data["evidence"])
    assert all(f["agentTaskId"] in task_ids for f in data["findings"])
    for finding in data["findings"]:
        assert finding["evidenceIds"]
        assert all(i in evidence_ids for i in finding["evidenceIds"])
    for rec in data["recommendations"]:
        assert all(i in finding_ids for i in rec["findingIds"])
    for evidence in data["evidence"]:
        if "metricId" in evidence["data"]:
            assert evidence["data"]["metricId"] in metric_ids
        if evidence["sourceType"] == "ANOMALY":
            assert evidence["data"]["anomalyId"] in anomaly_ids
    assert all(a["metricId"] in metric_ids for a in data["anomalies"])

    root = next(f for f in data["findings"] if f["id"] == data["rootCauseFindingId"])
    assert root["isRootCause"] is True
    assert root["analyticsType"] == "DIAGNOSTIC"
    assert "2026-10-08" in root["statement"]
    assert data["overallConfidence"] == root["confidence"]
    assert data["recommendations"]

    sequence = progress.sequence()
    assert sequence[:4] == [
        "status:PLANNING", "investigation.planning", "plan.produced", "status:IN_PROGRESS",
    ]
    assert "task.dispatched" in sequence and sequence[-1] == "investigation.synthesized"
    assert {r["investigationId"] for r in progress.reports} == {body["investigation"]["id"]}


def test_run_investigation_with_engine_down_is_failed_not_500(client, engine):
    engine.down = True
    response = client.post("/investigations/run", json=_run_body())
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "FAILED"
    assert data["tasks"][0]["status"] == "FAILED"
    assert data["findings"] == [] and data["rootCauseFindingId"] is None
    assert "unreachable" in data["summary"]


def test_run_investigation_without_data_sources_fails_cleanly(client, engine):
    data = client.post("/investigations/run", json=_run_body(data_sources=[])).json()
    assert data["status"] == "FAILED"
    assert "No connected data sources" in data["tasks"][0]["error"]
    assert engine.requests == []


def test_run_investigation_rejects_malformed_body(client):
    assert client.post("/investigations/run", json={"investigation": {}}).status_code == 422


@pytest.mark.asyncio
async def test_http_progress_reporter_posts_to_internal_endpoint():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    reporter = HttpProgressReporter(
        "http://api.test/", "secret", transport=httpx.MockTransport(handler)
    )
    inv_id = uuid4()
    await reporter.report(inv_id, status="PLANNING", event_type="investigation.planning",
                          payload={"question": "q"})
    await reporter.report(inv_id, status="IN_PROGRESS")

    assert str(seen[0].url) == f"http://api.test/api/v1/internal/investigations/{inv_id}/progress"
    assert seen[0].headers["x-helix-internal-token"] == "secret"
    first = json.loads(seen[0].content)
    assert first["status"] == "PLANNING"
    assert first["event"]["type"] == "investigation.planning"
    assert first["event"]["payload"] == {"question": "q"}
    assert first["event"]["at"].endswith("Z")
    assert json.loads(seen[1].content) == {"status": "IN_PROGRESS"}


@pytest.mark.asyncio
async def test_http_progress_reporter_swallows_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    reporter = HttpProgressReporter("http://api.test", "t", transport=httpx.MockTransport(handler))
    await reporter.report(uuid4(), status="PLANNING")  # must not raise


def test_settings_accept_global_unprefixed_names(monkeypatch):
    monkeypatch.setenv("ANALYTICS_ENGINE_URL", "http://engine:9000")
    monkeypatch.setenv("HELIX_API_URL", "http://api:4000")
    monkeypatch.setenv("HELIX_INTERNAL_TOKEN", "tok")
    s = Settings()
    assert (s.analytics_engine_url, s.helix_api_url, s.internal_token) == (
        "http://engine:9000", "http://api:4000", "tok",
    )
