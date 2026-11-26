import math
from uuid import uuid4

import pytest
from helix_agent_analytics import AnalyticsEngineClient
from helix_agent_analytics.testing import (
    FakeAnalyticsEngine,
    assembled_context,
    assert_numbers_backed,
    correlation_response,
    orders_data_source,
)
from helix_agent_finance import FinanceAgent
from helix_agent_finance.agent import volume_confidence
from helix_contracts import AgentTask, AgentTaskStatus, AgentType

REFUND_SAME_DAY = (
    "Refunds spiked on Thursday 2026-10-08: 37 against an expected 6.50 (deviation score "
    "+6.4, HIGH severity, detected by seasonal), on the same day as the revenue drop."
)
REFUND_NEXT_DAY = (
    "Refunds spiked on Friday 2026-10-09: 52 against an expected 6.75 (deviation score "
    "+9.3, CRITICAL severity, detected by seasonal), one day after the revenue drop on "
    "2026-10-08."
)
WEB_COLLAPSE = (
    "Web orders fell to 26 on Thursday 2026-10-08 against an expected 167.75 (-84.5%), while "
    "other channels were within their normal range, which points to a checkout or payment "
    "failure in the web channel rather than lower demand."
)


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


def _agent(engine: FakeAnalyticsEngine) -> FinanceAgent:
    return FinanceAgent(AnalyticsEngineClient("http://engine.test", transport=engine.transport))


def _task(input_context: dict) -> AgentTask:
    return AgentTask(
        id=uuid4(),
        investigationId=uuid4(),
        agentType=AgentType.FINANCE,
        status=AgentTaskStatus.QUEUED,
        objective="Explain the revenue drop through refunds, payments and revenue quality",
        inputContext=input_context,
    )


def _ctx(**kwargs) -> dict:
    return assembled_context("FINANCE", [orders_data_source(str(uuid4()))], **kwargs)


def _kinds(result: dict) -> list[str]:
    return [e["data"]["kind"] for e in result["evidence"]]


def _statements(result: dict) -> list[str]:
    return [f["statement"] for f in result["findings"]]


def test_metadata():
    agent = FinanceAgent()
    assert agent.agent_type == AgentType.FINANCE
    assert [c.name for c in agent.capabilities] == [
        "refund_analysis", "payment_failure_analysis", "revenue_quality",
    ]
    req = FinanceAgent.context_requirements
    assert req.semantic_types == ["datetime", "currency", "categorical"]
    assert req.table_keywords == ["order", "payment", "refund", "transaction", "invoice", "charge"]


def test_volume_confidence_formula():
    assert volume_confidence(1.0, -84.5) == 1.0
    assert volume_confidence(0.6, -30.0) == pytest.approx(0.6 * 0.8)
    assert volume_confidence(0.9, 0.0) == pytest.approx(0.45)
    assert volume_confidence(1.7, -10.0) == pytest.approx(0.6)
    assert volume_confidence(None, None) == 0.0


async def test_orders_scenario_with_focus_from_context(engine):
    done = await _agent(engine).execute(
        _task(_ctx(focus_dates=["2026-10-08"], metric_keys=["revenue"], direction="drop"))
    )
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    result = done.result

    # Focus came from the context, so no fallback anomaly detection on revenue.
    assert engine.paths() == ["/anomalies/detect", "/segments/compare", "/correlation"]
    refund_body = engine.requests[0][1]
    assert refund_body["filter"] == {
        "column": "status", "op": "in", "value": ["refunded", "refund", "returned"],
    }
    seg_body = engine.requests[1][1]
    assert seg_body["aggregation"] == "count" and "valueColumn" not in seg_body
    assert seg_body["targetDate"] == "2026-10-08"
    assert seg_body["dimensions"] == ["segment", "channel"]
    corr_body = engine.requests[2][1]
    assert corr_body["a"]["filter"] == {"column": "status", "op": "neq", "value": "refunded"}
    assert corr_body["a"]["aggregation"] == "sum" and corr_body["a"]["valueColumn"] == "amount"
    assert corr_body["b"]["aggregation"] == "count" and corr_body["method"] == "spearman"

    assert _statements(result) == [REFUND_SAME_DAY, REFUND_NEXT_DAY, WEB_COLLAPSE]
    assert _kinds(result) == ["co_anomaly", "co_anomaly", "segment_volume", "correlation"]
    assert [f["analyticsType"] for f in result["findings"]] == ["DIAGNOSTIC"] * 3
    assert all(f["agentType"] == "FINANCE" for f in result["findings"])

    co = [e for e in result["evidence"] if e["data"]["kind"] == "co_anomaly"]
    related = {"metricKey": "revenue", "date": "2026-10-08"}
    assert [e["data"]["relatedTo"] for e in co] == [related, related]
    assert all(e["sourceType"] == "ANOMALY" for e in co)
    assert {a["description"] for a in result["anomalies"]} == {
        "Spike in daily refunds on 2026-10-08", "Spike in daily refunds on 2026-10-09",
    }

    volume = next(e for e in result["evidence"] if e["data"]["kind"] == "segment_volume")
    data = volume["data"]
    # The engine's strict topSlice rule is not met for counts (-84.5% < 2 * -44.2%),
    # so the agent uses the most concentrated dimension's leading slice.
    assert data["topSliceSource"] == "best_dimension"
    assert data["topSlice"]["column"] == "channel" and data["topSlice"]["value"] == "web"
    assert data["metricKey"] == "orders" and data["concentration"] == 1.0

    confidences = [f["confidence"] for f in result["findings"]]
    # erf(|z| / sqrt(2)) capped at 0.999 for z = +6.4 and +9.3
    assert confidences[0] == min(0.999, round(math.erf(6.4 / math.sqrt(2)), 4)) == 0.999
    assert confidences[1] == 0.999
    assert confidences[2] == 1.0  # concentration 1.0 * min(1, 0.845 + 0.5)

    corr = result["evidence"][-1]
    assert corr["data"]["coefficient"] == 0.2554
    assert corr["confidence"] == pytest.approx(1 - 0.0151)
    assert any("below 0.5" in r for r in result["plan"]["reasoning"])
    assert result["plan"]["focusSource"] == "context"
    assert_numbers_backed(result)


async def test_no_focus_falls_back_to_own_revenue_detection(engine):
    done = await _agent(engine).execute(_task(_ctx()))
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    assert engine.paths() == [
        "/anomalies/detect", "/anomalies/detect", "/segments/compare", "/correlation",
    ]
    revenue_body = engine.requests[0][1]
    assert revenue_body["valueColumn"] == "amount" and "filter" not in revenue_body
    assert done.result["plan"]["focusSource"] == "detected"
    assert done.result["plan"]["focusDates"] == ["2026-10-08"]
    assert _statements(done.result) == [REFUND_SAME_DAY, REFUND_NEXT_DAY, WEB_COLLAPSE]


async def test_phase5_input_context_without_focus_keys(engine):
    done = await _agent(engine).execute(
        _task({
            "question": "Why did revenue drop?",
            "organizationId": str(uuid4()),
            "dataSources": [orders_data_source(str(uuid4()))],
        })
    )
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert WEB_COLLAPSE in _statements(done.result)


async def test_refunds_far_from_focus_are_not_claimed(engine):
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-09-01"])))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert "co_anomaly" not in _kinds(done.result)
    assert any("within one day" in r for r in done.result["plan"]["reasoning"])


async def test_strong_correlation_adds_descriptive_finding(engine):
    engine.overrides["/correlation"] = {
        **correlation_response({}), "coefficient": -0.7312, "pValue": 0.0004, "lag": 1,
    }
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    finding = done.result["findings"][-1]
    assert finding["analyticsType"] == "DESCRIPTIVE"
    assert finding["statement"] == (
        "Daily revenue (excluding refunds) and daily refunds are strongly negatively correlated "
        "(Spearman -0.73, p = 0.0004, n = 90 days, refunds shifted by 1 day(s))."
    )
    assert finding["confidence"] == pytest.approx(0.9996)
    assert_numbers_backed(done.result)


async def test_correlation_failure_is_a_warning(engine):
    engine.failures["/correlation"] = (422, "fewer than 10 overlapping days")
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert any("fewer than 10" in w for w in done.result["warnings"])


async def test_segment_error_fails_task_readably(engine):
    engine.failures["/segments/compare"] = (500, "ingestion unreachable")
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.FAILED
    assert "HTTP 500" in done.error and "ingestion unreachable" in done.error
    assert done.result["toolCalls"][-1]["ok"] is False
    assert done.completed_at is not None


async def test_engine_down_fails_task(engine):
    engine.down = True
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.FAILED
    assert "unreachable" in done.error


async def test_no_data_sources_fails_without_engine_calls(engine):
    done = await _agent(engine).execute(
        _task(assembled_context("FINANCE", [], focus_dates=["2026-10-08"]))
    )
    assert done.status == AgentTaskStatus.FAILED
    assert "No connected data sources" in done.error
    assert engine.requests == []


async def test_malformed_engine_response_fails_cleanly(engine):
    engine.overrides["/anomalies/detect"] = {"metric": {"name": "refunds"}}
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.FAILED
    assert done.error.startswith("Unexpected Finance Agent error")


async def test_no_focus_at_all_reports_top_two_refund_anomalies(engine, monkeypatch):
    from helix_agent_analytics import testing

    def no_revenue_anomalies(body):
        response = testing.anomaly_response(body)
        if not body.get("filter"):
            response["anomalies"] = []
        return response

    monkeypatch.setitem(testing.ROUTES, "/anomalies/detect", no_revenue_anomalies)
    done = await _agent(engine).execute(_task(_ctx()))
    assert done.status == AgentTaskStatus.SUCCEEDED
    result = done.result
    assert result["plan"]["focusSource"] == "none"
    assert "/segments/compare" not in engine.paths()
    anomalies = [e for e in result["evidence"] if e["data"]["kind"] == "anomaly"]
    # Ranked by |z|: 10-09 (+9.3) then 10-08 (+6.4); the +2.9 blip is left out.
    assert [e["data"]["date"] for e in anomalies] == ["2026-10-09", "2026-10-08"]
    assert all("relatedTo" not in e["data"] for e in anomalies)
    assert result["findings"][0]["statement"].endswith("detected by seasonal).")
    assert_numbers_backed(result)


async def test_broad_volume_drop_does_not_claim_checkout_failure(engine, monkeypatch):
    from helix_agent_analytics import testing

    slices = [("web", 20.0, 100.0), ("mobile", 40.0, 100.0), ("partner", 90.0, 100.0)]
    monkeypatch.setitem(testing.SEGMENT_SLICES, ("count", "channel"), slices)
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    statement = next(s for s in _statements(done.result) if "orders fell" in s)
    assert statement == (
        "Web orders fell to 20 on Thursday 2026-10-08 against an expected 100 (-80.0%), while "
        "other channels moved by up to 60.0%, which points to a problem concentrated in the "
        "web channel."
    )
    assert_numbers_backed(done.result)
