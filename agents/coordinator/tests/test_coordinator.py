import asyncio
from uuid import UUID, uuid4

from conftest import analytics_result, succeed_with
from helix_agent_coordinator import CoordinatorAgent, RecordingProgressReporter, build_plan
from helix_contracts import (
    AgentTask,
    AgentTaskStatus,
    AgentType,
    InvestigationRunResult,
)


def test_plan_has_exactly_one_analytics_step(run_request):
    plan = build_plan(run_request.investigation.question, run_request.data_sources)
    assert len(plan.steps) == 1
    step = plan.steps[0]
    assert (step.order, step.agent_type, step.depends_on) == (1, "ANALYTICS", [])
    assert "Why did revenue drop last week?" in step.objective
    assert "1 connected data source" in plan.reasoning


async def test_completed_run_selects_root_cause_and_links_everything(run_request):
    seen: list[AgentTask] = []

    async def dispatch(task):
        seen.append(task)
        return await succeed_with(anomalies=((-7.2, 0.999), (3.4, 0.95), (-3.1, 0.998)))(task)

    progress = RecordingProgressReporter()
    result = await CoordinatorAgent(dispatch, progress).run_investigation(run_request)
    InvestigationRunResult.model_validate(result.model_dump(mode="json", by_alias=True))

    # Hand-assembled context.
    ctx = seen[0].input_context
    assert ctx["question"] == "Why did revenue drop last week?"
    assert ctx["organizationId"] == str(run_request.investigation.organization_id)
    assert ctx["dataSources"][0]["schemas"][0]["tableName"] == "orders"
    assert seen[0].agent_type == AgentType.ANALYTICS

    assert result.status == "COMPLETED"
    assert len(result.steps) == len(result.tasks) == 1
    assert result.tasks[0].step_id == result.steps[0].id
    assert result.tasks[0].status == AgentTaskStatus.SUCCEEDED

    root = next(f for f in result.findings if f.id == result.root_cause_finding_id)
    assert root.is_root_cause and root.confidence == 0.999
    assert root.statement == "revenue drop on 2026-10-08."  # first of the tied 0.999s
    assert sum(f.is_root_cause for f in result.findings) == 1
    assert result.overall_confidence == 0.999
    assert result.summary.startswith("Root cause: revenue drop on 2026-10-08.")

    assert result.recommendations[0].priority == "HIGH"
    assert result.recommendations[0].title == "Investigate the revenue drop on 2026-10-08"
    assert result.recommendations[0].finding_ids == [root.id]
    assert "$191,300.00" in result.recommendations[0].expected_impact
    kpi_rec = next(r for r in result.recommendations if r.priority == "MEDIUM")
    assert kpi_rec.title == "Address the 13.9% decline in revenue"

    evidence_ids = {e.id for e in result.evidence}
    assert all(i in evidence_ids for f in result.findings for i in f.evidence_ids)
    finding_ids = {f.id for f in result.findings}
    assert all(i in finding_ids for r in result.recommendations for i in r.finding_ids)


async def test_progress_events_order(run_request):
    progress = RecordingProgressReporter()
    result = await CoordinatorAgent(succeed_with(), progress).run_investigation(run_request)
    assert progress.sequence() == [
        "status:PLANNING", "investigation.planning",
        "plan.produced",
        "status:IN_PROGRESS",
        "task.dispatched",
        "task.completed",
        "investigation.synthesized",
    ]
    reports = progress.reports
    assert reports[0]["status"] == "PLANNING"
    assert reports[0]["eventType"] == "investigation.planning"
    assert reports[1]["payload"]["plan"]["steps"][0]["agentType"] == "ANALYTICS"
    assert reports[2] == {**reports[2], "status": "IN_PROGRESS", "eventType": None}
    assert reports[3]["payload"]["taskId"] == str(result.tasks[0].id)
    assert reports[3]["payload"]["agentType"] == "ANALYTICS"
    assert reports[4]["payload"] == {"taskId": str(result.tasks[0].id), "findings": 2}
    assert reports[5]["payload"] == {
        "status": "COMPLETED",
        "overallConfidence": 0.999,
        "rootCauseFindingId": str(result.root_cause_finding_id),
    }


async def test_no_root_cause_below_threshold_uses_mean(run_request):
    dispatch = succeed_with(anomalies=((2.5, 0.8),), kpi_confidence=0.6, kpi_change=-2.0)
    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    assert result.status == "COMPLETED"
    assert result.root_cause_finding_id is None
    assert not any(f.is_root_cause for f in result.findings)
    assert result.overall_confidence == 0.7
    assert "No single finding reached the 90% confidence" in result.summary


async def test_refund_spike_gets_high_priority(run_request):
    dispatch = succeed_with(metric_key="refunds", direction="spike", kpi_change=40.0)
    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    titles = [(r.priority, r.title) for r in result.recommendations]
    assert titles[0] == ("HIGH", "Investigate the refund spike on 2026-10-08")
    assert ("MEDIUM", "Address the 40.0% increase in refunds") in titles


async def test_failed_only_step_fails_investigation(run_request):
    async def dispatch(task):
        task.status = AgentTaskStatus.FAILED
        task.error = "Analytics engine is unreachable at http://localhost:8002"
        return task

    progress = RecordingProgressReporter()
    result = await CoordinatorAgent(dispatch, progress).run_investigation(run_request)
    assert result.status == "FAILED"
    assert result.findings == [] and result.overall_confidence is None
    assert result.root_cause_finding_id is None
    assert "unreachable" in result.summary
    assert result.tasks[0].error.startswith("Analytics engine is unreachable")
    failed = next(r for r in progress.reports if r["eventType"] == "task.failed")
    assert "unreachable" in failed["payload"]["error"]
    assert progress.reports[-1]["payload"]["status"] == "FAILED"


async def test_partially_completed_when_one_of_two_steps_fails(run_request, monkeypatch):
    from helix_agent_coordinator import agent as agent_module
    from helix_contracts import InvestigationPlan, InvestigationPlanStep

    def two_step_plan(question, data_sources):
        return InvestigationPlan(steps=[
            InvestigationPlanStep(order=1, agentType="ANALYTICS", objective="a"),
            InvestigationPlanStep(order=2, agentType="ANALYTICS", objective="b"),
        ])

    monkeypatch.setattr(agent_module, "build_plan", two_step_plan)

    async def dispatch(task):
        if task.objective == "b":
            raise RuntimeError("boom")
        return await succeed_with()(task)

    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    assert result.status == "PARTIALLY_COMPLETED"
    assert [t.status for t in result.tasks] == [AgentTaskStatus.SUCCEEDED, AgentTaskStatus.FAILED]
    assert "boom" in result.tasks[1].error
    assert result.summary.startswith("Partially completed: 1 of 2 agent task(s) failed")
    assert result.root_cause_finding_id is not None


async def test_dependent_step_is_skipped_when_dependency_fails(run_request, monkeypatch):
    from helix_agent_coordinator import agent as agent_module
    from helix_contracts import InvestigationPlan, InvestigationPlanStep

    monkeypatch.setattr(agent_module, "build_plan", lambda q, d: InvestigationPlan(steps=[
        InvestigationPlanStep(order=1, agentType="ANALYTICS", objective="a"),
        InvestigationPlanStep(order=2, agentType="ANALYTICS", objective="b", dependsOn=[1]),
    ]))

    async def dispatch(task):
        task.status = AgentTaskStatus.FAILED
        task.error = "nope"
        return task

    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    assert result.status == "FAILED"
    assert result.tasks[1].status == AgentTaskStatus.SKIPPED


async def test_dispatch_timeout_marks_task_timed_out(run_request):
    async def slow(task):
        await asyncio.sleep(5)
        return task

    result = await CoordinatorAgent(slow, task_timeout_ms=50).run_investigation(run_request)
    assert result.status == "FAILED"
    task = result.tasks[0]
    assert task.status == AgentTaskStatus.TIMED_OUT
    assert task.timeout_ms == 50
    assert "timed out after 0.05s" in task.error
    assert task.started_at and task.completed_at


async def test_invalid_agent_result_fails_task(run_request):
    async def dispatch(task):
        task.status = AgentTaskStatus.SUCCEEDED
        task.result = {"findings": [{"id": "not-a-uuid"}]}
        return task

    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    assert result.status == "FAILED"
    assert result.tasks[0].status == AgentTaskStatus.FAILED


async def test_progress_failures_are_not_fatal(run_request):
    class Broken:
        async def report(self, *args, **kwargs):
            raise ConnectionError("api down")

    result = await CoordinatorAgent(succeed_with(), Broken()).run_investigation(run_request)
    assert result.status == "COMPLETED"


async def test_ids_are_uuids_and_dangling_links_are_dropped(run_request):
    async def dispatch(task):
        task.status = AgentTaskStatus.SUCCEEDED
        task.result = analytics_result(str(task.id))
        task.result["findings"][0]["evidenceIds"].append(str(uuid4()))
        return task

    result = await CoordinatorAgent(dispatch).run_investigation(run_request)
    dumped = result.model_dump(mode="json", by_alias=True)
    for key in ("steps", "tasks", "evidence", "findings", "recommendations", "metrics",
                "anomalies"):
        for item in dumped[key]:
            assert UUID(item["id"]).version == 4
    evidence_ids = {e["id"] for e in dumped["evidence"]}
    assert all(i in evidence_ids for f in dumped["findings"] for i in f["evidenceIds"])


async def test_execute_wraps_run_investigation(run_request):
    agent = CoordinatorAgent(succeed_with())
    task = AgentTask(
        id=uuid4(), investigationId=run_request.investigation.id,
        agentType=AgentType.COORDINATOR, status=AgentTaskStatus.QUEUED, objective="run",
        inputContext=run_request.model_dump(mode="json", by_alias=True),
    )
    done = await agent.execute(task)
    assert done.status == AgentTaskStatus.SUCCEEDED
    assert done.result["status"] == "COMPLETED"

    bad = await agent.execute(task.model_copy(update={"input_context": {"nope": 1}}))
    assert bad.status == AgentTaskStatus.FAILED
    assert "not a valid investigation run request" in bad.error
