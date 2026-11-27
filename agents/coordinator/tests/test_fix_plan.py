"""Culprit and fix plan on the root cause ranking (rules only, facts from the feed)."""

from conftest import DOMAIN
from helix_agent_coordinator import CoordinatorAgent
from helix_agent_coordinator.fix_plan import recovery
from helix_contracts import AgentTaskStatus, InvestigationRunResult, RunEvidence
from helix_root_cause.testing import RESULT_BUILDERS, SHA

ROLLBACK = {
    "version": "v2.14.1", "author": "carla.m", "deployedAt": "2026-10-09T06:15:00Z",
    "description": "Revert payment form changes",
    "commitSha": "0b82c07cac7b2a5dcf21773325e032421bcdb45f",
}


def dispatch_with(edit=None):
    """Ground truth dispatch; `edit(agent, result)` may change a result in place."""

    async def dispatch(task):
        task.status = AgentTaskStatus.SUCCEEDED
        task.result = RESULT_BUILDERS[task.agent_type.value](str(task.id))
        if edit is not None:
            edit(task.agent_type.value, task.result)
        return task

    return dispatch


def edit_event(fn):
    def edit(agent, result):
        if agent == "PRODUCT":
            fn(result["evidence"][0]["data"])
    return edit


async def run(request, edit=None):
    result = await CoordinatorAgent(
        dispatch_with(edit), available_agents=DOMAIN
    ).run_investigation(request)
    InvestigationRunResult.model_validate(result.model_dump(mode="json", by_alias=True))
    ranking = next(e for e in result.evidence if e.data["kind"] == "root_cause_ranking")
    root = next(f for f in result.findings if f.id == result.root_cause_finding_id)
    return result, ranking.data, root


async def test_rolled_back_culprit_and_plan(multi_request):
    result, data, root = await run(multi_request)
    culprit = data["culprit"]
    event = next(e for e in result.evidence if e.data["kind"] == "event_alignment")
    assert culprit == {
        "id": "dep_0038", "author": "carla.m", "service": "web-checkout", "version": "v2.14.0",
        "environment": "production", "status": "rolled_back",
        "description": "New payment form and address validation for web checkout",
        "commitSha": SHA, "commitUrl": None, "deployedAt": "2026-10-08T08:40:00Z",
        "history": event.data["history"], "evidenceId": str(event.id),
    }
    plan = data["fixPlan"]
    # The ground truth has no revenue anomaly after the rollback day through 2026-10-14.
    assert plan["state"] == "rolled_back"
    assert plan["recovered"] is True and plan["recoveredThrough"] == "2026-10-14"
    assert [s["kind"] for s in plan["steps"]] == ["verify", "verify", "review", "test", "prevent"]
    assert plan["steps"][0] == {
        "kind": "verify", "title": "Rollback is in place",
        "detail": 'web-checkout v2.14.1 "Revert payment form changes" by carla.m went out at '
        "06:15 UTC on 2026-10-09, replacing v2.14.0.",
    }
    assert plan["steps"][1]["title"] == "Confirm revenue is back to normal"
    assert "after 2026-10-09 (data checked through 2026-10-14)" in plan["steps"][1]["detail"]
    assert plan["steps"][2]["detail"] == (
        'Review commit 343a48d ("New payment form and address validation for web checkout") '
        "by carla.m; the affected path is the web channel."
    )
    assert plan["steps"][3]["title"] == (
        "Test the web checkout flow end to end in staging before re-releasing"
    )
    assert plan["steps"][4]["title"] == "Add a monitor on web orders"
    assert "shipped by carla.m" in root.statement


async def test_not_recovered_when_a_later_drop_exists(multi_request):
    def edit(agent, result):
        if agent == "ANALYTICS":
            anomaly = next(e for e in result["evidence"] if e["data"]["kind"] == "anomaly")
            later = {**anomaly, "id": "00000000-0000-4000-8000-000000000001",
                     "data": {**anomaly["data"], "date": "2026-10-12",
                              "timestamp": "2026-10-12T00:00:00+00:00"},
                     "confidence": 0.5}
            result["evidence"].append(later)

    _, data, _ = await run(multi_request, edit)
    plan = data["fixPlan"]
    assert plan["recovered"] is False
    assert plan["steps"][1]["title"] == "Revenue is still not back to expected"
    assert "again on 2026-10-12 after 2026-10-09" in plan["steps"][1]["detail"]


async def test_needs_rollback_names_previous_good_version(multi_request):
    def fn(data):
        data["event"]["labels"]["status"] = "success"
        data["change"]["status"] = "success"
        data["history"]["rollback"] = None

    result, data, root = await run(multi_request, edit_event(fn))
    plan = data["fixPlan"]
    assert plan["state"] == "needs_rollback"
    assert [s["kind"] for s in plan["steps"]] == ["rollback", "review", "verify", "prevent"]
    assert plan["steps"][0]["title"] == (
        "Roll back web-checkout to v2.13.0 (shipped by emeka.o on 2026-10-02)"
    )
    rec = result.recommendations[0]
    assert rec.priority == "CRITICAL"
    assert "1. Roll back web-checkout to v2.13.0" in rec.description
    assert "It has not been rolled back." in rec.description


async def test_failed_deploy_plan(multi_request):
    def fn(data):
        data["event"]["labels"]["status"] = "failed"
        data["change"]["status"] = "failed"
        data["history"]["rollback"] = None

    _, data, root = await run(multi_request, edit_event(fn))
    plan = data["fixPlan"]
    assert plan["state"] == "failed"
    assert plan["steps"][0]["title"] == "Confirm web-checkout v2.13.0 is still serving"
    assert "failed at 08:40 UTC on 2026-10-08" in plan["steps"][0]["detail"]
    assert plan["steps"][1]["title"] == "Find out why the deploy failed"
    assert "(the deploy failed), shipped by carla.m" in root.statement


async def test_missing_author(multi_request):
    def fn(data):
        data["change"]["author"] = None
        del data["event"]["labels"]["author"]

    result, data, root = await run(multi_request, edit_event(fn))
    assert data["culprit"]["author"] is None
    assert "shipped by" not in root.statement
    rec = result.recommendations[0]
    assert rec.title == "Fix the web-checkout v2.14.0 change"
    assert "Review commit 343a48d" in data["fixPlan"]["steps"][2]["detail"]
    assert " by " not in data["fixPlan"]["steps"][2]["detail"].split(")")[-1]


async def test_older_evidence_without_change_falls_back_to_labels(multi_request):
    def fn(data):
        del data["change"]
        del data["history"]

    _, data, _ = await run(multi_request, edit_event(fn))
    assert data["culprit"]["author"] == "carla.m" and data["culprit"]["history"] is None
    plan = data["fixPlan"]
    assert plan["state"] == "rolled_back"
    assert plan["steps"][0]["title"] == "Confirm the rollback is in place"


async def test_revert_is_not_a_culprit(multi_request):
    def fn(data):
        data["event"]["labels"].update(version="v2.14.1", status="success",
                                       description="Revert payment form changes")
        data["revert"] = True

    result, data, root = await run(multi_request, edit_event(fn))
    assert "culprit" not in data and "fixPlan" not in data
    assert "shipped by" not in root.statement
    assert not any(r.title.startswith("Fix the") for r in result.recommendations)


def test_recovery_unknown_without_later_data():
    kpi = RunEvidence.model_validate({
        "id": "00000000-0000-4000-8000-000000000002", "agentTaskId":
        "00000000-0000-4000-8000-000000000003", "sourceType": "METRIC",
        "source": {"description": "kpi"}, "summary": "kpi", "confidence": 1.0,
        "collectedAt": "2026-10-15T00:00:00Z",
        "data": {"kind": "kpi", "metricKey": "revenue",
                 "window": {"currentEnd": "2026-10-09T00:00:00Z"}},
    })
    from datetime import date

    assert recovery([kpi], metric_key="revenue", direction="drop",
                    after=date(2026, 10, 9)) == (None, date(2026, 10, 9), [])
    assert recovery([], metric_key="revenue", direction="drop",
                    after=date(2026, 10, 9)) == (None, None, [])
