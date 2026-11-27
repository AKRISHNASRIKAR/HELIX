import json
import math
from uuid import uuid4

import pytest
from helix_agent_analytics import AnalyticsEngineClient
from helix_agent_analytics.testing import (
    FakeAnalyticsEngine,
    assembled_context,
    assert_numbers_backed,
    deployments_data_source,
    orders_data_source,
)
from helix_agent_product import ProductAgent, event_confidence
from helix_contracts import AgentTask, AgentTaskStatus, AgentType, DataSourceType

WEB_CHECKOUT = (
    "Deployment web-checkout v2.14.0 to production at 08:40 UTC on Thursday 2026-10-08 landed "
    "8.7 hours into the revenue drop day (same day); it was later rolled back. Its labels "
    "mention checkout, payment and web, matching the affected metric or segment."
)
SEARCH = (
    "Deployment search v5.3.2 to production at 15:10 UTC on Wednesday 2026-10-07 came 8.8 hours "
    "before the start of the revenue drop day."
)
UPSTREAM_SEGMENT = {
    "id": str(uuid4()),
    "confidence": 0.999,
    "data": {
        "kind": "segment", "metricKey": "revenue", "date": "2026-10-08",
        "topSlice": {"column": "channel", "value": "web"},
    },
}


@pytest.fixture
def engine():
    return FakeAnalyticsEngine()


def _agent(engine: FakeAnalyticsEngine) -> ProductAgent:
    return ProductAgent(AnalyticsEngineClient("http://engine.test", transport=engine.transport))


def _task(input_context: dict) -> AgentTask:
    return AgentTask(
        id=uuid4(),
        investigationId=uuid4(),
        agentType=AgentType.PRODUCT,
        status=AgentTaskStatus.QUEUED,
        objective="Line up deployments with the anomaly",
        inputContext=input_context,
    )


def _sources(*, orders: bool = True, deployments: bool = True) -> list[dict]:
    sources = []
    if deployments:
        sources.append(deployments_data_source(str(uuid4())))
    if orders:
        sources.append(orders_data_source(str(uuid4())))
    return sources


def test_metadata():
    agent = ProductAgent()
    assert agent.agent_type == AgentType.PRODUCT
    assert [c.name for c in agent.capabilities] == ["deployment_correlation", "release_impact"]
    req = ProductAgent.context_requirements
    assert req.data_source_types == [DataSourceType.MCP, DataSourceType.GITHUB]
    assert req.table_keywords == ["deploy", "release", "commit", "change"]
    assert req.semantic_types == ["datetime"]


def test_event_confidence_formula():
    # same day: proximity 1.0; keyword match: relevance 1.0
    assert event_confidence(-8.67, True, ["web"]) == 1.0
    assert event_confidence(-8.67, True, []) == 0.4
    # before the day: exp(-hoursBefore / 24)
    assert event_confidence(12.0, False, ["checkout"]) == pytest.approx(math.exp(-0.5), abs=1e-4)
    assert event_confidence(8.8333, False, []) == pytest.approx(
        0.4 * math.exp(-8.8333 / 24), abs=1e-4
    )


async def test_orders_scenario_web_checkout_deploy_aligned(engine):
    sources = _sources()
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", sources, focus_dates=["2026-10-08"], metric_keys=["revenue"],
        direction="drop", upstream_evidence=[UPSTREAM_SEGMENT],
    )))
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    assert engine.paths() == ["/events/align", "/events/align"]
    body = engine.requests[0][1]
    assert body["targets"] == [{"date": "2026-10-08", "label": "revenue drop"}]
    assert body["windowHoursBefore"] == 24 and body["windowHoursAfter"] == 24
    assert body["events"]["timeColumn"] == "deployed_at"
    assert body["events"]["dataset"]["table"] == "deployments"
    assert body["events"]["dataset"]["dataSourceId"] == sources[0]["id"]
    assert "deployed_at" not in body["events"]["labelColumns"]
    assert "service" in body["events"]["labelColumns"]

    result = done.result
    assert [f["statement"] for f in result["findings"]] == [WEB_CHECKOUT, SEARCH]
    assert all(f["analyticsType"] == "DIAGNOSTIC" for f in result["findings"])
    assert [e["data"]["kind"] for e in result["evidence"]] == ["event_alignment"] * 2
    top = result["evidence"][0]
    assert top["sourceType"] == "API_RESPONSE"
    data = top["data"]
    assert data["date"] == "2026-10-08" and data["sameDay"] is True
    assert data["hoursBefore"] == pytest.approx(-8.6667, abs=1e-3)
    assert data["keywordMatch"] == ["checkout", "payment", "web"]
    assert data["event"]["labels"]["version"] == "v2.14.0"
    assert data["event"]["labels"]["status"] == "rolled_back"
    assert data["formatted"]["time"] == "08:40 UTC"
    # proximity 1.0 (same day) * relevance 1.0 (keyword match)
    assert result["findings"][0]["confidence"] == 1.0
    assert result["findings"][1]["confidence"] == pytest.approx(
        0.4 * math.exp(-(8 + 50 / 60) / 24), abs=1e-4
    )
    # The v2.14.1 fix landed after the anomaly day and is not a candidate cause.
    assert any("after 2026-10-08" in r for r in result["plan"]["reasoning"])
    assert_numbers_backed(result)


async def test_keywords_from_metric_even_without_upstream(engine):
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(), focus_dates=["2026-10-08"], direction="drop",
    )))
    data = done.result["evidence"][0]["data"]
    assert data["keywordMatch"] == ["checkout", "payment"]
    assert done.result["findings"][0]["confidence"] == 1.0


async def test_no_events_table_succeeds_with_zero_findings(engine):
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(deployments=False), focus_dates=["2026-10-08"],
    )))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.error is None
    assert done.result["findings"] == [] and done.result["evidence"] == []
    assert engine.requests == []
    assert "No deployment, release or commit table" in done.result["plan"]["reasoning"][0]


async def test_no_focus_falls_back_to_detection_on_tabular_sources(engine):
    done = await _agent(engine).execute(_task(assembled_context("PRODUCT", _sources())))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert engine.paths() == ["/anomalies/detect", "/events/align", "/events/align"]
    assert engine.requests[0][1]["dataset"]["table"] == "orders"
    assert engine.requests[1][1]["targets"][0]["date"] == "2026-10-08"
    assert done.result["plan"]["focusSource"] == "detected"
    assert done.result["findings"][0]["statement"].startswith("Deployment web-checkout v2.14.0")


async def test_no_focus_and_no_tabular_source_succeeds_empty(engine):
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(orders=False),
    )))
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.result["findings"] == []
    assert engine.requests == []
    assert done.result["plan"]["focusSource"] == "none"


async def test_failed_deploy_statement(engine, monkeypatch):
    from helix_agent_analytics import testing

    rows = [dict(row) for row in testing.DEPLOYMENTS]
    next(r for r in rows if r["version"] == "v2.14.0")["status"] = "failed"
    monkeypatch.setattr(testing, "DEPLOYMENTS", rows)
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(), focus_dates=["2026-10-08"], direction="drop",
    )))
    assert "(same day); it failed." in done.result["findings"][0]["statement"]


async def test_engine_error_fails_task_readably(engine):
    engine.failures["/events/align"] = (422, "Unknown column 'deployed_at'")
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(), focus_dates=["2026-10-08"],
    )))
    assert done.status == AgentTaskStatus.FAILED
    assert "HTTP 422" in done.error and "Unknown column 'deployed_at'" in done.error


async def test_engine_down_fails_task(engine):
    engine.down = True
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(), focus_dates=["2026-10-08"],
    )))
    assert done.status == AgentTaskStatus.FAILED
    assert "unreachable" in done.error


def test_reverts_are_down_weighted_as_responses_not_causes():
    from helix_agent_product.agent import REVERT_FACTOR, event_confidence, looks_like_revert

    assert looks_like_revert({"description": "Revert payment form changes"})
    assert looks_like_revert({"version": "v2.14.1-hotfix"})
    assert not looks_like_revert({"description": "New payment form and address validation"})
    cause = event_confidence(0.0, True, ["web"])
    fix = event_confidence(0.0, True, ["web"], revert=True)
    assert fix == round(cause * REVERT_FACTOR, 4)
    # The day-before deploy outranks a same-day revert.
    assert event_confidence(15.3, False, ["web"]) > fix


async def test_change_and_same_service_history(engine):
    sources = _sources()
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", sources, focus_dates=["2026-10-08"], direction="drop",
        upstream_evidence=[UPSTREAM_SEGMENT],
    )))
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    # One extra events query, filtered to the services of the recorded events.
    history_body = engine.requests[1][1]
    assert history_body["events"]["filter"] == {
        "column": "service", "op": "in", "value": ["search", "web-checkout"],
    }
    assert history_body["windowHoursBefore"] == 24 * 365
    assert history_body["targets"] == [{"date": "2026-10-08", "label": "deploy history"}]

    data = done.result["evidence"][0]["data"]
    assert data["change"] == {
        "id": "dep_0032", "author": "marco", "service": "web-checkout", "version": "v2.14.0",
        "environment": "production", "status": "rolled_back",
        "description": "New payment form and address validation for web checkout",
        "commitSha": "9f3a2d1", "commitUrl": None, "deployedAt": "2026-10-08T08:40:00Z",
    }
    assert data["history"] == {
        "previous": {"version": "v2.13.0", "author": "emeka",
                     "deployedAt": "2026-10-02T12:05:00Z", "status": "success",
                     "commitSha": "f1c169d"},
        "rollback": {"version": "v2.14.1", "author": "marco",
                     "deployedAt": "2026-10-09T06:15:00Z",
                     "description": "Revert payment form changes", "commitSha": "c71e5b8"},
    }
    # Existing keys stay as they were.
    assert data["event"]["labels"]["author"] == "marco" and data["revert"] is False
    # search has no other deploys in the feed: nothing to roll back to.
    search = done.result["evidence"][1]["data"]
    assert search["history"] == {"previous": None, "rollback": None}
    assert any("deploy history of search and web-checkout" in r
               for r in done.result["plan"]["reasoning"])
    assert_numbers_backed(done.result)


async def test_history_lookup_failure_keeps_alignment(engine, monkeypatch):
    import httpx

    original = engine._handle

    def flaky(request):
        body = json.loads(request.content or b"{}")
        if (body.get("events") or {}).get("filter"):
            return httpx.Response(500, json={"detail": "boom"})
        return original(request)

    monkeypatch.setattr(engine, "_handle", flaky)
    done = await _agent(engine).execute(_task(assembled_context(
        "PRODUCT", _sources(), focus_dates=["2026-10-08"], direction="drop",
    )))
    assert done.status == AgentTaskStatus.SUCCEEDED, done.error
    data = done.result["evidence"][0]["data"]
    assert data["history"] is None
    assert data["change"]["author"] == "marco"
    assert any(r.startswith("Deploy history lookup skipped") for r in
               done.result["plan"]["reasoning"])


def test_deploy_history_rules():
    from helix_agent_product.agent import change_from_event, commit_url, deploy_history

    def ev(time, version, status="success", description="x", env="production", **extra):
        return {"time": time, "labels": {"service": "api", "version": version,
                                         "status": status, "description": description,
                                         "environment": env, **extra}}

    cause = ev("2026-10-08T08:00:00Z", "v3", status="success", description="New thing")
    history = deploy_history(cause, [
        ev("2026-10-01T08:00:00Z", "v1"),
        ev("2026-10-03T08:00:00Z", "v2-bad", status="failed"),
        ev("2026-10-05T08:00:00Z", "v2-rb", status="rolled_back"),
        ev("2026-10-06T08:00:00Z", "v2-staging", env="staging"),
        cause,
        ev("2026-10-09T08:00:00Z", "v4", description="Unrelated feature"),
    ])
    # Failed, rolled back and other-environment deploys are not roll-back targets.
    assert history["previous"]["version"] == "v1"
    # The next deploy is neither a revert nor following a rolled-back deploy.
    assert history["rollback"] is None

    hotfix = deploy_history(cause, [cause, ev("2026-10-09T08:00:00Z", "v3.1",
                                              description="Hotfix for new thing")])
    assert hotfix["rollback"]["version"] == "v3.1" and hotfix["previous"] is None

    assert commit_url({"commit_sha": "abc", "repo_url": "https://git.example/acme/api/"}) == (
        "https://git.example/acme/api/commit/abc"
    )
    assert commit_url({"commit_sha": "abc", "repo": "acme/api"}) is None
    change = change_from_event({"time": "2026-10-08T08:00:00Z", "labels": {"version": "v3"}})
    assert change["author"] is None and change["deployedAt"] == "2026-10-08T08:00:00Z"
