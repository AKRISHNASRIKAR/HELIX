"""Wave execution, context assembly, snapshots and A2A message records."""

from datetime import UTC, datetime
from uuid import uuid4

from conftest import DOMAIN, ground_truth_dispatch
from helix_agent_coordinator import CoordinatorAgent, RecordingProgressReporter
from helix_contracts import (
    AgentTaskStatus,
    AgentType,
    AssembledContext,
    ContextAssembleRequest,
    InvestigationRunResult,
)

A = AgentType


def validate(result):
    return InvestigationRunResult.model_validate(result.model_dump(mode="json", by_alias=True))


async def test_dependents_wait_and_independent_steps_overlap(multi_request):
    seen = []
    dispatch = ground_truth_dispatch(
        seen=seen, delays={"ANALYTICS": 0.05, "FINANCE": 0.1, "CUSTOMER": 0.1, "PRODUCT": 0.1}
    )
    result = await CoordinatorAgent(dispatch, available_agents=DOMAIN).run_investigation(
        multi_request
    )
    validate(result)
    times = {(event, agent): t for event, agent, t, _ in seen}
    analytics_end = times[("end", "ANALYTICS")]
    for agent in ("FINANCE", "CUSTOMER", "PRODUCT"):
        assert times[("start", agent)] >= analytics_end  # waits for step 0
    starts = [times[("start", a)] for a in ("FINANCE", "CUSTOMER", "PRODUCT")]
    ends = [times[("end", a)] for a in ("FINANCE", "CUSTOMER", "PRODUCT")]
    assert max(starts) < min(ends)  # all three were in flight together
    # Ran as one wave: well under the 0.3s a sequential run would need.
    assert max(ends) - analytics_end < 0.25
    synthesis = result.tasks[-1]
    assert synthesis.agent_type == A.COORDINATOR
    assert synthesis.started_at.timestamp() >= max(
        t.completed_at.timestamp() for t in result.tasks[:-1]
    )


class RecordingProvider:
    def __init__(self, fail_for=()):
        self.requests: list[ContextAssembleRequest] = []
        self.fail_for = set(fail_for)

    async def assemble(self, request: ContextAssembleRequest) -> AssembledContext:
        self.requests.append(request)
        if request.agent_type.value in self.fail_for:
            raise ConnectionError("context engine down")
        inv = request.investigation
        return AssembledContext(
            contextId=uuid4(), source="context-engine", assembledAt=datetime.now(UTC),
            agentType=request.agent_type, agentTaskId=request.agent_task_id,
            question=inv["question"], investigationId=inv["id"],
            organizationId=inv["organizationId"], projectId=inv["projectId"],
            triggerType=inv["triggerType"], step=request.step,
            dataSources=request.data_sources, upstream=request.upstream,
            focus={"anomalyDates": ["2026-10-08"], "metricKeys": ["revenue"]},
            tokenCount=1234,
        )


async def test_context_provider_requests_and_snapshots(multi_request):
    provider = RecordingProvider()
    progress = RecordingProgressReporter()
    seen = []
    result = await CoordinatorAgent(
        ground_truth_dispatch(seen=seen), progress, context=provider, available_agents=DOMAIN
    ).run_investigation(multi_request)
    validate(result)

    by_agent = {r.agent_type: r for r in provider.requests}
    assert set(by_agent) == {A.ANALYTICS, A.FINANCE, A.CUSTOMER, A.PRODUCT}
    assert by_agent[A.ANALYTICS].upstream.findings == []
    assert by_agent[A.ANALYTICS].requirements.include_upstream is False
    analytics_task = result.tasks[0]
    upstream_ids = {f.id for f in by_agent[A.FINANCE].upstream.findings}
    assert upstream_ids == {f.id for f in result.findings
                            if f.agent_task_id == analytics_task.id}
    assert {e.data["kind"] for e in by_agent[A.PRODUCT].upstream.evidence} == {
        "kpi", "anomaly", "segment",
    }
    assert by_agent[A.PRODUCT].requirements.data_source_types == ["MCP", "GITHUB"]
    assert by_agent[A.FINANCE].investigation["id"] == str(multi_request.investigation.id)

    # One snapshot per task (synthesis included), keyed by the task id.
    assert [s.agent_task_id for s in result.context_snapshots] != []
    assert {s.agent_task_id for s in result.context_snapshots} == {t.id for t in result.tasks}
    for task in result.tasks:
        snap = next(s for s in result.context_snapshots if s.agent_task_id == task.id)
        assert snap.agent_type == task.agent_type
        assert snap.assembled_context == task.input_context
        assert task.input_context["agentTaskId"] == str(task.id)
        expected = "coordinator" if task.agent_type == A.COORDINATOR else "context-engine"
        assert task.input_context["source"] == expected
        if task.agent_type != A.COORDINATOR:
            assert snap.token_count == 1234
    # The dispatched AgentTask carried the assembled context.
    dispatched = {t.agent_type: t for event, _, _, t in seen if event == "start"}
    assert dispatched[A.FINANCE].input_context["focus"]["anomalyDates"] == ["2026-10-08"]

    assembled = [r["payload"] for r in progress.reports if r["eventType"] == "context.assembled"]
    assert len(assembled) == 5
    assert {p["taskId"] for p in assembled} == {str(t.id) for t in result.tasks}
    assert {p["source"] for p in assembled} == {"context-engine", "coordinator"}
    assert all(set(p) == {"taskId", "agentType", "source", "tokenCount"} for p in assembled)


async def test_context_fallback_when_provider_fails(multi_request):
    provider = RecordingProvider(fail_for={"FINANCE"})
    result = await CoordinatorAgent(
        ground_truth_dispatch(), context=provider, available_agents=DOMAIN
    ).run_investigation(multi_request)
    assert result.status == "COMPLETED"
    finance = next(t for t in result.tasks if t.agent_type == A.FINANCE)
    ctx = AssembledContext.model_validate(finance.input_context)
    assert ctx.source == "fallback"
    assert ctx.agent_task_id == finance.id
    assert "context engine failed (context engine down)" in ctx.decisions[0].reason
    assert ctx.decisions[0].rule == "fallback"
    # Locally derived focus from upstream ANALYTICS evidence.
    assert ctx.focus.anomaly_dates == ["2026-10-08"]
    assert ctx.focus.metric_keys == ["revenue"]
    assert ctx.focus.direction == "drop"
    assert len(ctx.upstream.findings) == 3
    assert ctx.token_count and ctx.token_count > 0
    assert len(ctx.data_sources) == 2
    snap = next(s for s in result.context_snapshots if s.agent_task_id == finance.id)
    assert snap.token_count == ctx.token_count


async def test_no_provider_assembles_fallback_with_trigger_focus():
    from conftest import make_request

    request = make_request(
        "Daily revenue anomaly", trigger_type="ANOMALY_DETECTED",
        trigger_context={"metricKey": "revenue", "date": "2026-10-08", "direction": "drop"},
    )
    seen = []
    await CoordinatorAgent(
        ground_truth_dispatch(seen=seen), available_agents=DOMAIN
    ).run_investigation(request)
    analytics = next(t for e, a, _, t in seen if e == "start" and a == "ANALYTICS")
    ctx = AssembledContext.model_validate(analytics.input_context)
    assert ctx.source == "fallback"
    assert "No context provider is configured" in ctx.decisions[0].reason
    assert ctx.focus.anomaly_dates == ["2026-10-08"]
    assert ctx.trigger_context["metricKey"] == "revenue"
    assert ctx.upstream.findings == []  # ANALYTICS does not take upstream


async def test_messages_recorded_with_ids_transport_and_passthrough(multi_request):
    def extra(task):
        return [{
            "id": str(uuid4()), "type": "STATUS_UPDATE", "fromAgent": "A2A_GATEWAY",
            "toAgent": "COORDINATOR", "payload": {"routed": True},
            "correlationId": str(task.id), "createdAt": datetime.now(UTC).isoformat(),
        }, {"not": "a message"}]

    result = await CoordinatorAgent(
        ground_truth_dispatch(fail={"CUSTOMER"}, transport="a2a-gateway", messages=extra),
        available_agents=DOMAIN,
    ).run_investigation(multi_request)
    validate(result)

    for task in result.tasks:
        msgs = [m for m in result.messages if m.correlation_id == str(task.id)]
        if task.agent_type == A.COORDINATOR:
            assert msgs == []
            continue
        assert all(m.agent_task_id == task.id for m in msgs)
        if task.status != AgentTaskStatus.SUCCEEDED:  # failed: no result, no extras
            request, reply = msgs
            assert request.type == "TASK_REQUEST"
            assert reply.type == "ERROR"
            assert reply.payload["error"] == "CUSTOMER exploded"
            continue
        request, gateway, reply = msgs
        assert request.type == "TASK_REQUEST"
        assert (request.from_agent, request.to_agent) == ("COORDINATOR", task.agent_type.value)
        assert request.payload["objective"] == task.objective
        assert request.payload["contextId"] == task.input_context["contextId"]
        assert gateway.type == "STATUS_UPDATE" and gateway.from_agent == "A2A_GATEWAY"
        assert (reply.from_agent, reply.to_agent) == (task.agent_type.value, "COORDINATOR")
        assert request.payload["transport"] == "a2a-gateway"
        assert reply.type == "TASK_RESULT"
        n = sum(1 for f in result.findings if f.agent_task_id == task.id)
        assert reply.payload == {"status": "SUCCEEDED", "findings": n,
                                 "transport": "a2a-gateway"}
        assert "_messages" not in task.result
    assert len(result.messages) == 3 * 3 + 2


async def test_dispatch_exception_records_error_message(multi_request):
    async def dispatch(task):
        if task.agent_type == A.PRODUCT:
            raise RuntimeError("gateway 503")
        return await ground_truth_dispatch()(task)

    result = await CoordinatorAgent(dispatch, available_agents=DOMAIN).run_investigation(
        multi_request
    )
    product = next(t for t in result.tasks if t.agent_type == A.PRODUCT)
    assert product.status == AgentTaskStatus.FAILED
    reply = [m for m in result.messages if m.agent_task_id == product.id][-1]
    assert reply.type == "ERROR" and "gateway 503" in reply.payload["error"]
