import math
from uuid import uuid4

import pytest
from helix_agent_analytics import AnalyticsEngineClient
from helix_agent_analytics.testing import (
    FakeAnalyticsEngine,
    assembled_context,
    assert_numbers_backed,
    orders_data_source,
)
from helix_agent_customer import CustomerAgent
from helix_contracts import AgentTask, AgentTaskStatus, AgentType

NEUTRAL = (
    "Customer segments do not explain the revenue drop on 2026-10-08: enterprise, mid_market "
    "and smb all moved within 11.7 percentage points of the overall change (-38.8%)."
)
ACTIVE_DROP = (
    "Active customers dropped on Thursday 2026-10-08: 171 against an expected 304.50 "
    "(deviation score -6.8, CRITICAL severity, detected by seasonal), on the same day as the "
    "revenue drop."
)


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


def _agent(engine: FakeAnalyticsEngine) -> CustomerAgent:
    return CustomerAgent(AnalyticsEngineClient("http://engine.test", transport=engine.transport))


def _task(input_context: dict) -> AgentTask:
    return AgentTask(
        id=uuid4(),
        investigationId=uuid4(),
        agentType=AgentType.CUSTOMER,
        status=AgentTaskStatus.QUEUED,
        objective="Check customer activity and segment mix",
        inputContext=input_context,
    )


def _ctx(**kwargs) -> dict:
    return assembled_context("CUSTOMER", [orders_data_source(str(uuid4()))], **kwargs)


def _by_kind(result: dict, kind: str) -> list[dict]:
    return [e for e in result["evidence"] if e["data"]["kind"] == kind]


def _finding_for(result: dict, evidence: dict) -> dict:
    return next(f for f in result["findings"] if evidence["id"] in f["evidenceIds"])


def test_metadata():
    agent = CustomerAgent()
    assert agent.agent_type == AgentType.CUSTOMER
    assert [c.name for c in agent.capabilities] == ["customer_activity", "segment_mix"]
    req = CustomerAgent.context_requirements
    assert req.semantic_types == ["datetime", "identifier", "categorical"]
    assert req.table_keywords == ["customer", "user", "order", "account"]


async def test_orders_scenario_segments_are_neutral(engine):
    done = await _agent(engine).execute(
        _task(_ctx(focus_dates=["2026-10-08"], metric_keys=["revenue"], direction="drop"))
    )
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    result = done.result
    assert engine.paths() == ["/kpis", "/anomalies/detect", "/segments/compare"]
    kpi_body = engine.requests[0][1]
    assert kpi_body["kpis"][0]["aggregation"] == "count_distinct"
    assert kpi_body["kpis"][0]["column"] == "customer_id"
    seg_body = engine.requests[2][1]
    # Only customer attributes: channel (and status, ids) are never customer segments.
    assert seg_body["dimensions"] == ["segment"]
    assert seg_body["aggregation"] == "sum" and seg_body["valueColumn"] == "amount"
    assert seg_body["targetDate"] == "2026-10-08"

    [neutral] = _by_kind(result, "segment_neutral")
    assert neutral["data"]["concentration"] == pytest.approx(0.4938)
    assert neutral["data"]["topSlice"] is None
    finding = _finding_for(result, neutral)
    assert finding["statement"] == NEUTRAL
    assert finding["analyticsType"] == "DIAGNOSTIC"
    assert finding["confidence"] == pytest.approx(1 - 0.4938)  # 1 - concentration

    [kpi] = _by_kind(result, "kpi")
    kpi_finding = _finding_for(result, kpi)
    assert kpi_finding["analyticsType"] == "DESCRIPTIVE"
    assert kpi_finding["confidence"] == pytest.approx(1 - 0.041)  # 1 - pValue
    assert "active customers came to 2,031, down 11.3%" in kpi_finding["statement"]

    [co] = _by_kind(result, "co_anomaly")
    assert co["data"]["relatedTo"] == {"metricKey": "revenue", "date": "2026-10-08"}
    assert _finding_for(result, co)["statement"] == ACTIVE_DROP
    assert _finding_for(result, co)["confidence"] == 0.999
    assert all(f["agentType"] == "CUSTOMER" for f in result["findings"])
    assert_numbers_backed(result)


async def test_concentrated_customer_segment_is_a_normal_segment_finding(engine, monkeypatch):
    from helix_agent_analytics import testing

    slices = [("enterprise", 200.0, 3000.0), ("mid_market", 9000.0, 9100.0),
              ("smb", 6000.0, 5900.0)]
    monkeypatch.setitem(testing.SEGMENT_SLICES, ("sum", "segment"), slices)
    upstream = [{
        "id": str(uuid4()), "confidence": 0.9,
        "data": {"kind": "anomaly", "metricKey": "revenue", "date": "2026-10-08",
                 "metricName": "revenue"},
    }]
    done = await _agent(engine).execute(
        _task(_ctx(focus_dates=["2026-10-08"], upstream_evidence=upstream, direction="drop"))
    )
    [segment] = _by_kind(done.result, "segment")
    finding = _finding_for(done.result, segment)
    assert finding["statement"] == (
        "The revenue drop on Thursday 2026-10-08 is concentrated in segment = enterprise: "
        "enterprise revenue was $200.00 against an expected $3,000.00 (-93.3%), 100.0% of "
        "the total shortfall."
    )
    # concentration (1.0) * upstream anomaly confidence (0.9)
    assert finding["confidence"] == pytest.approx(0.9)
    assert _by_kind(done.result, "segment_neutral") == []
    assert_numbers_backed(done.result)


async def test_no_focus_falls_back_to_own_detection(engine):
    done = await _agent(engine).execute(_task(_ctx()))
    assert done.status == AgentTaskStatus.SUCCEEDED
    # Revenue fallback detection, then KPI + active-customer anomalies + segments.
    assert engine.paths() == ["/anomalies/detect", "/kpis", "/anomalies/detect",
                              "/segments/compare"]
    assert done.result["plan"]["focusSource"] == "detected"
    statements = [f["statement"] for f in done.result["findings"]]
    assert NEUTRAL in statements and ACTIVE_DROP in statements


async def test_no_customer_attribute_columns_skips_segment_mix(engine):
    source = orders_data_source(str(uuid4()))
    columns = source["schemas"][0]["columns"]
    source["schemas"][0]["columns"] = [c for c in columns if c["name"] != "segment"]
    done = await _agent(engine).execute(
        _task(assembled_context("CUSTOMER", [source], focus_dates=["2026-10-08"]))
    )
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert "/segments/compare" not in engine.paths()
    assert any("no customer attribute columns" in r for r in done.result["plan"]["reasoning"])


async def test_engine_error_fails_task_readably(engine):
    engine.failures["/kpis"] = (502, "ingestion unreachable")
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.FAILED
    assert "HTTP 502" in done.error and "ingestion unreachable" in done.error


async def test_engine_down_fails_task(engine):
    engine.down = True
    done = await _agent(engine).execute(_task(_ctx(focus_dates=["2026-10-08"])))
    assert done.status == AgentTaskStatus.FAILED
    assert "unreachable" in done.error and done.completed_at is not None


async def test_missing_organization_fails(engine):
    ctx = _ctx(focus_dates=["2026-10-08"])
    ctx.pop("organizationId")
    done = await _agent(engine).execute(_task(ctx))
    assert done.status == AgentTaskStatus.FAILED
    assert "organizationId" in done.error
    assert math.isclose(len(engine.requests), 0)
