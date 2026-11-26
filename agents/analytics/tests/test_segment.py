"""Phase 7: segment step, AssembledContext input, new engine client methods."""

from uuid import uuid4

import httpx
import pytest
from helix_agent_analytics import AnalyticsAgent, AnalyticsEngineClient
from helix_agent_analytics.engine_client import ToolCallLog, summarize_request
from helix_agent_analytics.testing import (
    FakeAnalyticsEngine,
    anomaly_response,
    assembled_context,
    assert_numbers_backed,
    orders_data_source,
    unbacked_numbers,
)
from helix_contracts import AgentTask, AgentTaskStatus, AgentType

WEB_STATEMENT = (
    "The revenue drop on Thursday 2026-10-08 is concentrated in channel = web: web revenue "
    "was $2,991.88 against an expected $17,515.16 (-82.9%), more than the whole day's "
    "shortfall on its own, while other channel values moved the other way."
)


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


def _agent(engine: FakeAnalyticsEngine) -> AnalyticsAgent:
    return AnalyticsAgent(AnalyticsEngineClient("http://engine.test", transport=engine.transport))


def _task(input_context: dict) -> AgentTask:
    return AgentTask(
        id=uuid4(),
        investigationId=uuid4(),
        agentType=AgentType.ANALYTICS,
        status=AgentTaskStatus.QUEUED,
        objective="Why did revenue drop last week?",
        inputContext=input_context,
    )


def _assembled() -> dict:
    return assembled_context("ANALYTICS", [orders_data_source(str(uuid4()))])


def _segments(result: dict) -> list[dict]:
    return [e for e in result["evidence"] if e["data"]["kind"] == "segment"]


def test_context_requirements():
    req = AnalyticsAgent.context_requirements
    assert req.semantic_types == ["datetime", "currency", "numeric", "categorical", "identifier"]
    assert req.include_upstream is False


async def test_segment_step_on_assembled_context(engine):
    done = await _agent(engine).execute(_task(_assembled()))
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error

    path, body = engine.requests[2]
    assert path == "/segments/compare"
    assert body["targetDate"] == "2026-10-08"
    assert body["aggregation"] == "sum" and body["valueColumn"] == "amount"
    # Outcome (status) and identifier columns are never segments.
    assert body["dimensions"] == ["segment", "channel"]
    assert body["baseline"] == "same_weekday" and body["unit"] == "USD"

    result = done.result
    [segment] = _segments(result)
    data = segment["data"]
    assert segment["sourceType"] == "METRIC"
    assert data["topSlice"]["column"] == "channel" and data["topSlice"]["value"] == "web"
    assert data["concentration"] == 1.0
    assert data["date"] == "2026-10-08" and data["direction"] == "drop"
    assert data["metricKey"] == "revenue" and data["unit"] == "USD"
    assert data["dimensions"][0]["column"] == "channel"
    anomaly_ids = {e["id"] for e in result["evidence"] if e["data"]["kind"] == "anomaly"}
    assert data["anomalyEvidenceId"] in anomaly_ids

    finding = next(f for f in result["findings"] if f["evidenceIds"] == [segment["id"]])
    assert finding["statement"] == WEB_STATEMENT
    assert finding["analyticsType"] == "DIAGNOSTIC"
    # confidence = anomaly confidence (0.999) * concentration (1.0)
    assert finding["confidence"] == pytest.approx(0.999)
    assert result["plan"] == result["analysisPlan"]
    assert_numbers_backed(result)


async def test_partial_concentration_scales_confidence(engine):
    response = {
        "targetDate": "2026-10-08", "metricName": "revenue", "unit": "USD",
        "aggregation": "sum",
        "total": {"actual": 100.0, "expected": 200.0, "delta": -100.0, "deltaPercent": -50.0},
        "dimensions": [{"column": "channel", "concentration": 0.8, "slices": [
            {"value": "web", "actual": 10.0, "expected": 90.0, "delta": -80.0,
             "deltaPercent": -88.89, "shareOfDelta": 0.8},
        ]}],
        "topSlice": {"column": "channel", "value": "web", "actual": 10.0, "expected": 90.0,
                     "delta": -80.0, "deltaPercent": -88.89, "shareOfDelta": 0.8},
        "computationMethod": "test",
    }
    engine.overrides["/segments/compare"] = response
    done = await _agent(engine).execute(_task(_assembled()))
    [segment] = _segments(done.result)
    finding = next(f for f in done.result["findings"] if f["evidenceIds"] == [segment["id"]])
    assert finding["confidence"] == pytest.approx(0.999 * 0.8, abs=1e-4)
    assert "80.0% of the total shortfall." in finding["statement"]
    assert_numbers_backed(done.result)


async def test_null_top_slice_emits_nothing(engine):
    engine.overrides["/segments/compare"] = {
        "total": {"actual": 1.0, "expected": 2.0, "delta": -1.0, "deltaPercent": -50.0},
        "dimensions": [], "topSlice": None, "computationMethod": "test",
    }
    done = await _agent(engine).execute(_task(_assembled()))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert _segments(done.result) == []
    assert len(done.result["findings"]) == 4
    assert any("no single slice" in r for r in done.result["plan"]["reasoning"])


async def test_medium_top_anomaly_skips_segment_step(engine):
    response = anomaly_response({"metricName": "revenue"})
    for anomaly in response["anomalies"]:
        anomaly["severity"] = "MEDIUM"
    engine.overrides["/anomalies/detect"] = response
    done = await _agent(engine).execute(_task(_assembled()))
    assert "/segments/compare" not in engine.paths()
    assert _segments(done.result) == []


async def test_segment_failure_is_a_warning(engine):
    engine.failures["/segments/compare"] = (404, "Not Found")
    done = await _agent(engine).execute(_task(_assembled()))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert any("Segment comparison skipped" in w for w in done.result["warnings"])


async def test_new_client_methods_post_to_spec_paths(engine):
    client = AnalyticsEngineClient("http://engine.test", transport=engine.transport)
    log = ToolCallLog()
    seg = await client.compare_segments(
        {"dataset": {"rows": [{"a": 1}]}, "timeColumn": "t", "aggregation": "count",
         "targetDate": "2026-10-08"}, log,
    )
    corr = await client.correlate({"a": {"dataset": {"rows": []}}, "b": {}}, log)
    align = await client.align_events(
        {"events": {"dataset": {"rows": [{}, {}]}, "timeColumn": "deployed_at"},
         "targets": [{"date": "2026-10-08"}]}, log,
    )
    assert engine.paths() == ["/segments/compare", "/correlation", "/events/align"]
    assert seg["topSlice"] is None  # count: web -84.5% is not 2x the total -44.2%
    assert seg["dimensions"][0]["slices"][0]["value"] == "web"
    assert corr["method"] == "spearman"
    assert align["matches"][0]["events"][0]["labels"]["service"] == "web-checkout"
    # Inline rows never reach the tool-call log, even when nested.
    assert log.calls[2].request["events"]["dataset"] == {"rowCount": 2}
    assert summarize_request({"a": {"dataset": {"rows": [1]}}})["a"]["dataset"] == {
        "rowCount": 1
    }


async def test_engine_without_new_endpoint_still_succeeds():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/segments/compare":
            return httpx.Response(404, json={"detail": "Not Found"})
        return FakeAnalyticsEngine().transport.handle_request(request)

    agent = AnalyticsAgent(
        AnalyticsEngineClient("http://engine.test", transport=httpx.MockTransport(handler))
    )
    done = await agent.execute(_task(_assembled()))
    assert done.status == AgentTaskStatus.SUCCEEDED


def test_unbacked_numbers_helper():
    data = [{"value": 26.0, "date": "2026-10-08", "formatted": {"expected": "$17,515.16",
             "time": "08:40 UTC", "v": "web-checkout v2.14.0"}}]
    assert unbacked_numbers(
        "Web orders fell to 26 on 2026-10-08 vs $17,515.16 at 08:40 (v2.14.0).", data
    ) == []
    assert unbacked_numbers("Fell to 27 on 2026-10-09 at 09:10.", data) == [
        "09:10", "2026-10-09", "27",
    ]


async def test_every_analytics_statement_number_is_backed(engine):
    done = await _agent(engine).execute(_task(assembled_context(
        "ANALYTICS", [orders_data_source(str(uuid4()))],
        question="Why did revenue drop, and what will it be next week?",
    )))
    assert any(f["analyticsType"] == "PREDICTIVE" for f in done.result["findings"])
    assert_numbers_backed(done.result)
