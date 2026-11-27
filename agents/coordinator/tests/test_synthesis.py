"""Multi-agent synthesis on the orders ground truth (spec sections 2 and 5.5)."""

from conftest import DOMAIN, ground_truth_dispatch
from helix_agent_coordinator import CoordinatorAgent, RecordingProgressReporter
from helix_agent_coordinator.synthesis import summary_numbers_ok
from helix_contracts import AgentTaskStatus, AgentType, InvestigationRunResult
from helix_llm import FakeLlm, LlmError

A = AgentType


async def run(request, **kwargs):
    dispatch = kwargs.pop("dispatch", None) or ground_truth_dispatch(
        fail=kwargs.pop("fail", ())
    )
    result = await CoordinatorAgent(dispatch, available_agents=DOMAIN, **kwargs).run_investigation(
        request
    )
    InvestigationRunResult.model_validate(result.model_dump(mode="json", by_alias=True))
    return result


async def test_ground_truth_root_cause(multi_request):
    progress = RecordingProgressReporter()
    result = await run(multi_request, progress=progress)
    assert result.status == "COMPLETED"
    assert [t.agent_type for t in result.tasks] == [
        A.ANALYTICS, A.FINANCE, A.CUSTOMER, A.PRODUCT, A.COORDINATOR,
    ]
    synthesis = result.tasks[-1]
    assert synthesis.status == AgentTaskStatus.SUCCEEDED
    assert synthesis.step_id == result.steps[-1].id

    root = next(f for f in result.findings if f.id == result.root_cause_finding_id)
    assert root.agent_type == A.COORDINATOR
    assert root.agent_task_id == synthesis.id
    assert root.analytics_type == "DIAGNOSTIC" and root.is_root_cause
    assert sum(f.is_root_cause for f in result.findings) == 1
    assert "2026-10-08" in root.statement
    assert "channel = web" in root.statement
    assert "web-checkout v2.14.0 deploy" in root.statement
    assert root.statement == (
        "Revenue dropped 40.0% on Thursday 2026-10-08 because web orders collapsed "
        "(channel = web explains 94.8% of the $13,174.00 shortfall), starting shortly after "
        "the web-checkout v2.14.0 deploy at 08:40 UTC (later rolled back), shipped by carla.m; "
        "refunds also spiked on 2026-10-08 and 2026-10-09. Customer segment mix was ruled out "
        "as the driver."
    )
    assert root.confidence >= 0.75
    assert root.confidence == 0.949
    assert result.overall_confidence == root.confidence

    # Evidence links: every contributing kind plus the ranking evidence.
    evidence = {e.id: e for e in result.evidence}
    kinds = {evidence[i].data["kind"] for i in root.evidence_ids}
    assert kinds == {"anomaly", "segment", "segment_volume", "co_anomaly", "correlation",
                     "segment_neutral", "event_alignment", "root_cause_ranking"}
    ranking = next(e for e in result.evidence if e.data["kind"] == "root_cause_ranking")
    assert ranking.agent_task_id == synthesis.id and ranking.source_type == "METRIC"
    assert ranking.id == root.evidence_ids[-1]
    assert ranking.data["selectedCandidateId"] == ranking.data["candidates"][0]["id"]
    assert ranking.data["candidates"][0]["score"] == 0.949
    assert ranking.data["formatted"] == {"score": "94.9%"}
    assert synthesis.result["findings"][0]["id"] == str(root.id)
    assert synthesis.result["evidence"][0]["id"] == str(ranking.id)
    assert all(i in evidence for f in result.findings for i in f.evidence_ids)

    # Summary leads with the composed root cause.
    assert result.summary.startswith(f"Root cause: {root.statement}")
    assert result.meta == {"planner": "rules", "summaryWriter": "rules", "llmCalls": 0,
                           "llmErrors": [], "rootCauseMethod": "ranked"}

    # Recommendations: web channel and deploy first, refund audits, linked findings.
    titles = [(r.priority, r.title) for r in result.recommendations]
    assert titles[0] == ("CRITICAL", "Fix the web-checkout v2.14.0 change (caused by carla.m)")
    assert ("HIGH", "Investigate the web channel on 2026-10-08") in titles
    assert ("HIGH", "Investigate the refund spike on 2026-10-08") in titles
    assert ("HIGH", "Investigate the refund spike on 2026-10-09") in titles
    assert ("HIGH", "Investigate the revenue drop on 2026-10-08") in titles
    deploy = result.recommendations[0]
    assert deploy.description.startswith(
        "web-checkout v2.14.0, shipped by carla.m at 08:40 UTC on 2026-10-08, is the most likely "
        "trigger of the revenue anomaly. It has since been rolled back. Fix plan: "
        "1. Rollback is in place. 2. Confirm revenue is back to normal. "
        "3. Fix the change before re-shipping."
    )
    finding_ids = {f.id for f in result.findings}
    for rec in result.recommendations:
        assert rec.finding_ids and all(i in finding_ids for i in rec.finding_ids)
    assert root.id in deploy.finding_ids
    web = next(r for r in result.recommendations if "web channel" in r.title)
    assert "checkout and payment funnel" in web.description

    events = [r["eventType"] for r in progress.reports if r["eventType"]]
    assert events[-1] == "investigation.synthesized"
    assert events.count("context.assembled") == 5
    assert events.count("task.completed") == 5
    assert progress.reports[-1]["payload"]["rootCauseFindingId"] == str(root.id)


async def test_partially_completed_with_failed_finance(multi_request):
    result = await run(multi_request, fail={"FINANCE"})
    assert result.status == "PARTIALLY_COMPLETED"
    statuses = {t.agent_type: t.status for t in result.tasks}
    assert statuses[A.FINANCE] == AgentTaskStatus.FAILED
    assert statuses[A.COORDINATOR] == AgentTaskStatus.SUCCEEDED
    assert result.summary.startswith(
        "Partially completed: 1 of 4 agent task(s) failed (Finance Agent: FINANCE exploded)."
    )
    root = next(f for f in result.findings if f.id == result.root_cause_finding_id)
    # Without Finance: no volume collapse, no refund co-anomalies, still a root cause.
    assert root.agent_type == A.COORDINATOR
    assert "refunds" not in root.statement
    assert "concentrated in channel = web" in root.statement
    assert "web-checkout v2.14.0 deploy" in root.statement
    assert root.confidence >= 0.75


async def test_synthesis_skipped_when_every_domain_task_fails(multi_request):
    result = await run(multi_request, fail={"ANALYTICS"})
    assert result.status == "FAILED"
    statuses = [t.status for t in result.tasks]
    assert statuses[0] == AgentTaskStatus.FAILED
    assert statuses[1:] == [AgentTaskStatus.SKIPPED] * 4
    assert "nothing to synthesize" in result.tasks[-1].error
    assert result.root_cause_finding_id is None and result.findings == []
    assert result.summary.startswith("Investigation failed: no agent task completed")


async def test_below_threshold_names_strongest_candidate(multi_request):
    from helix_root_cause.testing import RESULT_BUILDERS

    async def dispatch(task):
        task.status = AgentTaskStatus.SUCCEEDED
        task.result = RESULT_BUILDERS[task.agent_type.value](str(task.id))
        for e in task.result["evidence"]:
            if e["data"]["kind"] == "anomaly":
                e["confidence"] = 0.3
            if e["data"]["kind"] in ("segment", "segment_volume"):
                e["data"]["concentration"] = 0.2
            if e["data"]["kind"] in ("event_alignment", "co_anomaly"):
                e["data"]["date"] = "2026-09-01"
        for f in task.result["findings"]:
            f["confidence"] = min(f["confidence"], 0.5)
        return task

    result = await run(multi_request, dispatch=dispatch)
    assert result.root_cause_finding_id is None
    assert not any(f.agent_type == A.COORDINATOR for f in result.findings)
    assert "No root-cause candidate reached the 75% score" in result.summary
    assert "Strongest candidate (score " in result.summary
    ranking = next(e for e in result.evidence if e.data["kind"] == "root_cause_ranking")
    assert ranking.data["selectedCandidateId"] is None


# ---------------------------------------------------------------------------
# LLM summary writer + number guard
# ---------------------------------------------------------------------------


def planner_error_then(summary_response):
    return FakeLlm(responses=[LlmError("planner off"), summary_response], model="fake-opus")


async def test_llm_summary_accepted_when_numbers_are_grounded(multi_request):
    text = ("Revenue fell 40.0% on Thursday 2026-10-08 because web checkout broke after the "
            "web-checkout v2.14.0 deploy at 08:40 UTC: web orders dropped to 26 against an "
            "expected 171.5, and channel = web explains 94.8% of the $13,174 shortfall. "
            "Refunds also spiked. Review the deploy first.")
    llm = planner_error_then({"summary": text})
    result = await run(multi_request, llm=llm)
    assert result.summary == text
    assert result.meta["summaryWriter"] == "llm"
    assert result.meta["planner"] == "rules"
    assert result.meta["llmCalls"] == 2
    assert result.meta["llmModel"] == "fake-opus"
    prompt = llm.calls[1]["user"]
    assert "Root cause (confidence 94.9%): Revenue dropped 40.0%" in prompt
    assert "- Fix the web-checkout v2.14.0 change (caused by carla.m)" in prompt
    assert llm.calls[1]["schema"]["required"] == ["summary"]


async def test_llm_summary_with_invented_number_is_rejected(multi_request):
    llm = planner_error_then({"summary": "Revenue fell 52% on 2026-10-08, costing $20,000."})
    result = await run(multi_request, llm=llm)
    assert result.summary.startswith("Root cause: Revenue dropped 40.0%")
    assert result.meta["summaryWriter"] == "rules"
    assert result.meta["llmErrors"][-1] == (
        "summary: summary contains numbers not in the findings: 52, 20,000"
    )


async def test_llm_summary_error_falls_back(multi_request):
    result = await run(multi_request, llm=planner_error_then(LlmError("refused")))
    assert result.meta["summaryWriter"] == "rules"
    assert result.meta["llmErrors"] == ["planner: planner off", "summary: refused"]


def test_number_guard():
    allowed = ["Revenue was $13,174.00 short on 2026-10-08 (94.8%)."]
    assert summary_numbers_ok("A $13,174 gap on 2026-10-08, 94.8% of it web.", allowed) == []
    assert summary_numbers_ok("Down 41% on 2026-10-08.", allowed) == ["41"]
    assert summary_numbers_ok("No numbers here.", []) == []
    assert summary_numbers_ok("3 agents", []) == ["3"]
