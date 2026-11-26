import math
from uuid import UUID, uuid4

import pytest
from helix_agent_analytics import AnalyticsAgent, AnalyticsEngineClient
from helix_agent_analytics.formatting import (
    confidence_from_deviation,
    confidence_from_mape,
    confidence_from_p_value,
    format_value,
)
from helix_agent_analytics.testing import FakeAnalyticsEngine, orders_data_source
from helix_contracts import AgentTask, AgentTaskStatus, AgentType


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


def _agent(engine: FakeAnalyticsEngine) -> AnalyticsAgent:
    return AnalyticsAgent(
        AnalyticsEngineClient("http://engine.test", transport=engine.transport)
    )


def _task(question: str, data_sources=None, org_id: str | None = None) -> AgentTask:
    if data_sources is None:
        data_sources = [orders_data_source(str(uuid4()))]
    return AgentTask(
        id=uuid4(),
        investigationId=uuid4(),
        agentType=AgentType.ANALYTICS,
        status=AgentTaskStatus.QUEUED,
        objective=question,
        inputContext={
            "question": question,
            "organizationId": org_id or str(uuid4()),
            "dataSources": data_sources,
        },
    )


def test_confidence_math():
    assert confidence_from_deviation(-7.2) == 0.999
    assert confidence_from_deviation(1.0) == pytest.approx(math.erf(1 / math.sqrt(2)), abs=1e-4)
    assert confidence_from_p_value(0.012) == pytest.approx(0.988)
    assert confidence_from_p_value(None) == 0.5
    assert confidence_from_mape(8.0) == pytest.approx(0.92)
    assert confidence_from_mape(170.0) == 0.0


def test_format_value():
    assert format_value(1204331.25, "USD") == "$1,204,331.25"
    assert format_value(0.182, "ratio") == "18.2%"
    assert format_value(1234.0, None) == "1,234"


async def test_happy_path_produces_linked_evidence_and_findings(engine):
    task = _task("Why did revenue drop last week?")
    org_id = task.input_context["organizationId"]
    ds_id = task.input_context["dataSources"][0]["id"]

    done = await _agent(engine).execute(task)

    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.error is None
    assert done.started_at and done.completed_at
    # The top anomaly is CRITICAL, so the Phase 7 segment step runs too.
    assert engine.paths() == ["/kpis", "/anomalies/detect", "/segments/compare"]
    kpi_body = engine.requests[0][1]
    assert kpi_body["dataset"] == {"dataSourceId": ds_id, "organizationId": org_id,
                                   "table": "orders"}
    assert kpi_body["windowDays"] == 7
    assert engine.requests[1][1]["method"] == "auto"

    result = done.result
    evidence = {e["id"]: e for e in result["evidence"]}
    metrics = {m["id"]: m for m in result["metrics"]}
    anomalies = {a["id"]: a for a in result["anomalies"]}

    # 1 KPI + top 3 anomalies + 1 segment breakdown.
    assert len(result["findings"]) == 5
    assert len(anomalies) == 3
    assert result["anomalyCount"] == 4
    for finding in result["findings"]:
        assert finding["agentTaskId"] == str(task.id)
        assert finding["evidenceIds"]
        for evidence_id in finding["evidenceIds"]:
            assert evidence_id in evidence
    for item in result["evidence"]:
        assert item["data"]["metricId"] in metrics
        if item["sourceType"] == "ANOMALY":
            assert item["data"]["anomalyId"] in anomalies
            assert anomalies[item["data"]["anomalyId"]]["metricId"] == item["data"]["metricId"]

    kpi = next(f for f in result["findings"] if f["analyticsType"] == "DESCRIPTIVE")
    assert kpi["confidence"] == pytest.approx(0.988)
    assert "$1,204,331.25" in kpi["statement"]
    assert "down 13.9%" in kpi["statement"]

    diagnostic = [f for f in result["findings"] if f["analyticsType"] == "DIAGNOSTIC"]
    # Question says "drop": the -7.2 drop ranks first, then the other drop, then the spike.
    assert "dropped on Thursday 2026-10-08" in diagnostic[0]["statement"]
    assert diagnostic[0]["confidence"] == 0.999
    assert diagnostic[1]["confidence"] == pytest.approx(math.erf(3.1 / math.sqrt(2)), abs=1e-4)
    assert "spiked" in diagnostic[2]["statement"]
    assert "concentrated in channel = web" in diagnostic[3]["statement"]
    assert [t["endpoint"] for t in result["toolCalls"]] == [
        "/kpis", "/anomalies/detect", "/segments/compare",
    ]
    for item in result["metrics"]:
        UUID(item["id"])
        assert item["computationMethod"]


async def test_forecast_question_adds_predictive_finding(engine):
    done = await _agent(engine).execute(_task("What will revenue be next week?"))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert engine.paths()[-1] == "/forecast"
    predictive = [f for f in done.result["findings"] if f["analyticsType"] == "PREDICTIVE"]
    assert len(predictive) == 1
    assert predictive[0]["confidence"] == pytest.approx(0.92)
    assert "backtest MAPE 8.0%" in predictive[0]["statement"]


async def test_forecast_failure_is_a_warning_not_a_failure(engine):
    engine.failures["/forecast"] = (422, "too few points to forecast")
    done = await _agent(engine).execute(_task("Forecast revenue"))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert any("too few points" in w for w in done.result["warnings"])


async def test_engine_down_fails_task_without_raising(engine):
    engine.down = True
    done = await _agent(engine).execute(_task("Why did revenue drop?"))
    assert done.status == AgentTaskStatus.FAILED
    assert "unreachable" in done.error
    assert done.completed_at is not None
    assert done.result["toolCalls"][0]["ok"] is False


async def test_engine_4xx_fails_task_with_detail(engine):
    engine.failures["/anomalies/detect"] = (422, "Unknown column 'amount'")
    done = await _agent(engine).execute(_task("Why did revenue drop?"))
    assert done.status == AgentTaskStatus.FAILED
    assert "HTTP 422" in done.error and "Unknown column 'amount'" in done.error


async def test_engine_5xx_fails_task(engine):
    engine.failures["/kpis"] = (502, "ingestion unreachable")
    done = await _agent(engine).execute(_task("Why did revenue drop?"))
    assert done.status == AgentTaskStatus.FAILED
    assert "HTTP 502" in done.error


async def test_no_dataset_fails_without_calling_engine(engine):
    done = await _agent(engine).execute(_task("Why did revenue drop?", data_sources=[]))
    assert done.status == AgentTaskStatus.FAILED
    assert "No connected data sources" in done.error
    assert engine.requests == []


async def test_malformed_engine_response_fails_cleanly(engine):
    engine.overrides["/kpis"] = {"metrics": [{"name": "revenue"}]}
    done = await _agent(engine).execute(_task("Why did revenue drop?"))
    assert done.status == AgentTaskStatus.FAILED
    assert done.error.startswith("Unexpected Analytics Agent error")


def test_capabilities():
    agent = AnalyticsAgent()
    assert agent.agent_type == AgentType.ANALYTICS
    assert [c.name for c in agent.capabilities] == [
        "kpi_analysis", "trend_analysis", "anomaly_detection", "forecasting",
    ]
