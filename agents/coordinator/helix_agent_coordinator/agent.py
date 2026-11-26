"""The Coordinator Agent (Phases 5 to 7).

run_investigation() is the whole investigation:
    question -> plan (planner.py, rules or LLM) -> waves of AgentTasks whose
    dependencies are satisfied, dispatched concurrently, each with an
    AssembledContext from the ContextProvider -> synthesis RunTask
    (synthesis.py + helix_root_cause) -> InvestigationRunResult

The Coordinator never imports another agent. It hands each AgentTask to an
injected `dispatch` callable (agent-runtime decides in-process vs A2A
gateway), gets each task's context from an injected ContextProvider, records
the A2A messages and context snapshots, and reports live progress through an
injected ProgressReporter. Any LLM use is optional and falls back to rules.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentCapability,
    AgentMessageType,
    AgentTask,
    AgentTaskStatus,
    AgentType,
    AssembledContext,
    BaseAgent,
    ContextAssembleRequest,
    ContextRequirements,
    ContextStep,
    ContextUpstream,
    InvestigationPlan,
    InvestigationRunRequest,
    InvestigationRunResult,
    RunAnomaly,
    RunContextSnapshot,
    RunEvidence,
    RunFinding,
    RunMessage,
    RunMetric,
    RunStep,
    RunTask,
)
from pydantic import ValidationError

from . import __version__
from .context import DEFAULT_REQUIREMENTS, ContextProvider, assemble_locally, token_count
from .planner import build_llm_plan, build_plan, with_synthesis
from .progress import NullProgressReporter, ProgressReporter
from .synthesis import (
    LLM_SUMMARY_SYSTEM,
    SUMMARY_SCHEMA,
    RootCauseOutcome,
    build_recommendations,
    build_summary,
    overall_confidence,
    run_status,
    summary_inputs,
    summary_numbers_ok,
    synthesize_root_cause,
)

logger = logging.getLogger(__name__)

Dispatch = Callable[[AgentTask], Awaitable[AgentTask]]

CAPABILITIES = [
    AgentCapability(
        name="investigation_planning",
        description="Turns a question into a multi-agent InvestigationPlan (rules or LLM).",
    ),
    AgentCapability(
        name="task_delegation",
        description=(
            "Dispatches AgentTasks in dependency waves (concurrently), each with an "
            "assembled context, and records the A2A messages."
        ),
    ),
    AgentCapability(
        name="synthesis",
        description=(
            "Ranks root-cause candidates across agents and writes the root cause, overall "
            "confidence, summary, and recommendations."
        ),
    ),
]

_TERMINAL = (AgentTaskStatus.SUCCEEDED, AgentTaskStatus.FAILED, AgentTaskStatus.TIMED_OUT)
_COORDINATOR = AgentType.COORDINATOR.value


def _now() -> datetime:
    return datetime.now(UTC)


class _Run:
    """Mutable state of one investigation run."""

    def __init__(self, request: InvestigationRunRequest):
        self.request = request
        self.tasks: dict[int, RunTask] = {}
        self.evidence_by_order: dict[int, list[RunEvidence]] = {}
        self.findings_by_order: dict[int, list[RunFinding]] = {}
        self.metrics: list[RunMetric] = []
        self.anomalies: list[RunAnomaly] = []
        self.messages: list[RunMessage] = []
        self.snapshots: list[RunContextSnapshot] = []
        self.outcome: RootCauseOutcome | None = None
        self.meta: dict[str, Any] = {
            "planner": "rules",
            "summaryWriter": "rules",
            "llmCalls": 0,
            "llmErrors": [],
        }


class CoordinatorAgent(BaseAgent):
    agent_type = AgentType.COORDINATOR
    name = "Coordinator Agent"
    description = (
        "Plans an investigation, delegates agent tasks, and assembles the final "
        "investigation (summary, root cause, recommendations)."
    )
    version = __version__

    def __init__(
        self,
        dispatch: Dispatch,
        progress: ProgressReporter | None = None,
        *,
        task_timeout_ms: int = 60_000,
        context: ContextProvider | None = None,
        llm: Any | None = None,
        available_agents: set[AgentType] | None = None,
        context_requirements: dict[AgentType, ContextRequirements] | None = None,
    ):
        self._dispatch = dispatch
        self._progress = progress or NullProgressReporter()
        self.task_timeout_ms = task_timeout_ms
        self._context = context
        self._llm = llm
        self.available_agents = (
            {a for a in available_agents if a != AgentType.COORDINATOR}
            if available_agents is not None
            else None
        )
        self._requirements = {**DEFAULT_REQUIREMENTS, **(context_requirements or {})}

    @property
    def capabilities(self) -> list[AgentCapability]:
        return list(CAPABILITIES)

    # ------------------------------------------------------------------
    # BaseAgent boundary
    # ------------------------------------------------------------------

    async def execute(self, task: AgentTask) -> AgentTask:
        """inputContext is an InvestigationRunRequest; result is the InvestigationRunResult."""
        task = task.model_copy(deep=True)
        task.status = AgentTaskStatus.RUNNING
        task.started_at = task.started_at or _now()
        try:
            request = InvestigationRunRequest.model_validate(task.input_context)
            result = await self.run_investigation(request)
        except ValidationError as exc:
            task.status = AgentTaskStatus.FAILED
            task.error = (
                "inputContext is not a valid investigation run request: "
                f"{exc.error_count()} validation error(s)."
            )
        except Exception as exc:  # the BaseAgent boundary must never raise
            logger.exception("Coordinator failed unexpectedly on task %s", task.id)
            task.status = AgentTaskStatus.FAILED
            task.error = f"Unexpected Coordinator error: {exc}"
        else:
            task.result = result.model_dump(mode="json", by_alias=True)
            if result.status == "FAILED":
                task.status = AgentTaskStatus.FAILED
                task.error = result.summary
            else:
                task.status = AgentTaskStatus.SUCCEEDED
        task.completed_at = _now()
        return task

    # ------------------------------------------------------------------
    # The investigation
    # ------------------------------------------------------------------

    async def run_investigation(self, request: InvestigationRunRequest) -> InvestigationRunResult:
        inv = request.investigation
        run = _Run(request)
        await self._report(
            inv.id,
            status="PLANNING",
            event_type="investigation.planning",
            payload={"question": inv.question},
        )
        plan = await self._plan(request, run)
        if not any(s.agent_type == _COORDINATOR for s in plan.steps):
            plan = InvestigationPlan(
                steps=with_synthesis(sorted(plan.steps, key=lambda s: s.order)),
                reasoning=plan.reasoning,
            )
        await self._report(
            inv.id,
            event_type="plan.produced",
            payload={"plan": plan.model_dump(mode="json", by_alias=True)},
        )
        await self._report(inv.id, status="IN_PROGRESS")

        steps = [
            RunStep(
                id=uuid4(),
                order=s.order,
                agentType=s.agent_type,
                objective=s.objective,
                dependsOn=s.depends_on,
            )
            for s in sorted(plan.steps, key=lambda s: s.order)
        ]
        await self._execute_waves(steps, run)

        # Assemble the result ------------------------------------------------
        ordered = [run.tasks[s.order] for s in steps if s.order in run.tasks]
        domain_tasks = [t for t in ordered if t.agent_type != AgentType.COORDINATOR]
        status = run_status(domain_tasks)
        evidence = [e for s in steps for e in run.evidence_by_order.get(s.order, [])]
        findings = [f for s in steps for f in run.findings_by_order.get(s.order, [])]
        outcome = run.outcome
        root = outcome.root if outcome else None
        candidate = outcome.candidate if outcome else None
        if root is not None:
            root.is_root_cause = True
        confidence = overall_confidence(findings, root)
        evidence_by_id = {e.id: e for e in evidence}
        recommendations = build_recommendations(findings, evidence_by_id, root)
        summary = build_summary(status, domain_tasks, findings, root, confidence, candidate)
        if status != "FAILED" and findings:
            summary = await self._llm_summary(
                run, summary, status=status, root=root, candidate=candidate,
                findings=findings, recommendations=recommendations, evidence=evidence,
            )

        result = InvestigationRunResult(
            status=status,
            plan=plan,
            steps=steps,
            tasks=ordered,
            evidence=evidence,
            findings=findings,
            recommendations=recommendations,
            metrics=run.metrics,
            anomalies=run.anomalies,
            summary=summary,
            overallConfidence=confidence,
            rootCauseFindingId=root.id if root else None,
            messages=run.messages,
            contextSnapshots=run.snapshots,
            meta=run.meta,
        )
        await self._report(
            inv.id,
            event_type="investigation.synthesized",
            payload={
                "status": status,
                "overallConfidence": confidence,
                "rootCauseFindingId": str(root.id) if root else None,
            },
        )
        return result

    # ------------------------------------------------------------------
    # Planning
    # ------------------------------------------------------------------

    async def _plan(self, request: InvestigationRunRequest, run: _Run) -> InvestigationPlan:
        inv = request.investigation
        kwargs = {
            "trigger_type": inv.trigger_type,
            "trigger_context": inv.trigger_context,
            "available_agents": self.available_agents,
        }
        if self._llm is not None:
            run.meta["llmModel"] = getattr(self._llm, "model", None)
            run.meta["llmCalls"] += 1
            try:
                plan = await build_llm_plan(
                    self._llm, inv.question, request.data_sources, **kwargs
                )
            except Exception as exc:  # LlmError, PlanValidationError, ... -> rules
                logger.warning("LLM planner failed, using rules: %s", exc)
                run.meta["llmErrors"].append(f"planner: {exc}")
            else:
                run.meta["planner"] = "llm"
                return plan
        return build_plan(inv.question, request.data_sources, **kwargs)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def _execute_waves(self, steps: list[RunStep], run: _Run) -> None:
        pending = {s.order: s for s in steps}
        known = set(pending)
        while pending:
            done_orders = set(run.tasks)
            ready = [
                s for s in pending.values()
                if all(d in done_orders or d not in known for d in s.depends_on)
            ]
            if not ready:
                # A dependency cycle or a reference to a later step: skip the rest.
                for step in list(pending.values()):
                    run.tasks[step.order] = self._skipped(
                        step, run, "Skipped: its dependencies can never complete."
                    )
                break
            wave = []
            for step in ready:
                del pending[step.order]
                if step.agent_type == AgentType.COORDINATOR:
                    wave.append(self._run_synthesis(step, steps, run))
                    continue
                blocked = [
                    d for d in step.depends_on
                    if d in known and run.tasks[d].status != AgentTaskStatus.SUCCEEDED
                ]
                if blocked:
                    run.tasks[step.order] = self._skipped(
                        step, run, f"Skipped: depends on unsuccessful step(s) {blocked}."
                    )
                    continue
                wave.append(self._run_step(step, run))
            if wave:
                await asyncio.gather(*wave)

    def _skipped(self, step: RunStep, run: _Run, reason: str) -> RunTask:
        return RunTask(
            id=uuid4(),
            stepId=step.id,
            agentType=step.agent_type,
            status=AgentTaskStatus.SKIPPED,
            objective=step.objective,
            error=reason,
            timeoutMs=self.task_timeout_ms,
        )

    def _upstream(self, step: RunStep, run: _Run) -> ContextUpstream:
        return ContextUpstream(
            findings=[f for d in step.depends_on for f in run.findings_by_order.get(d, [])],
            evidence=[e for d in step.depends_on for e in run.evidence_by_order.get(d, [])],
        )

    async def _assemble(
        self, step: RunStep, task_id: UUID, run: _Run
    ) -> AssembledContext:
        inv = run.request.investigation
        assemble_request = ContextAssembleRequest(
            investigation=inv.model_dump(mode="json", by_alias=True),
            agentTaskId=task_id,
            agentType=step.agent_type,
            step=ContextStep(order=step.order, objective=step.objective),
            requirements=self._requirements.get(step.agent_type, ContextRequirements()),
            dataSources=run.request.data_sources,
            upstream=self._upstream(step, run),
        )
        if self._context is None:
            return assemble_locally(
                assemble_request, inv, source="fallback",
                reason="No context provider is configured; the Coordinator assembled the "
                "context locally (all connected data sources, upstream results, no history).",
            )
        try:
            context = await self._context.assemble(assemble_request)
            if not isinstance(context, AssembledContext):
                context = AssembledContext.model_validate(context)
        except Exception as exc:  # the context engine is optional for the run
            logger.warning("Context assembly failed for task %s: %s", task_id, exc)
            return assemble_locally(
                assemble_request, inv, source="fallback",
                reason=f"The context engine failed ({exc}); the Coordinator assembled the "
                "context locally (all connected data sources, upstream results, no history).",
            )
        context.agent_task_id = task_id
        if context.token_count is None:
            context.token_count = token_count(context.model_dump(mode="json", by_alias=True))
        return context

    async def _record_context(
        self, step: RunStep, task_id: UUID, context: AssembledContext, run: _Run
    ) -> dict[str, Any]:
        payload = context.model_dump(mode="json", by_alias=True)
        run.snapshots.append(
            RunContextSnapshot(
                id=uuid4(),
                agentTaskId=task_id,
                agentType=step.agent_type,
                assembledContext=payload,
                tokenCount=context.token_count,
                createdAt=_now(),
            )
        )
        await self._report(
            run.request.investigation.id,
            event_type="context.assembled",
            payload={
                "taskId": str(task_id),
                "agentType": step.agent_type.value,
                "source": context.source,
                "tokenCount": context.token_count,
            },
        )
        return payload

    async def _run_step(self, step: RunStep, run: _Run) -> None:
        inv = run.request.investigation
        task_id = uuid4()
        context = await self._assemble(step, task_id, run)
        input_context = await self._record_context(step, task_id, context, run)
        agent_task = AgentTask(
            id=task_id,
            investigationId=inv.id,
            agentType=step.agent_type,
            status=AgentTaskStatus.QUEUED,
            objective=step.objective,
            inputContext=input_context,
            timeoutMs=self.task_timeout_ms,
        )
        await self._report(
            inv.id,
            event_type="task.dispatched",
            payload={
                "taskId": str(task_id),
                "agentType": step.agent_type.value,
                "objective": step.objective,
            },
        )
        request_message = RunMessage(
            id=uuid4(),
            type=AgentMessageType.TASK_REQUEST,
            agentTaskId=task_id,
            fromAgent=_COORDINATOR,
            toAgent=step.agent_type.value,
            payload={"objective": step.objective, "contextId": str(context.context_id)},
            correlationId=str(task_id),
            createdAt=_now(),
        )
        run.messages.append(request_message)

        done = await self._dispatch_with_timeout(agent_task)
        transport = self._transport(done)
        extra_messages = self._extra_messages(done)
        if transport is not None:
            request_message.payload["transport"] = transport

        collected = self._collect(done)
        if collected is None:
            done.status = AgentTaskStatus.FAILED
            done.error = done.error or "Agent returned a result that is not valid."
            collected = ([], [], [], [])
        evidence, findings, metrics, anomalies = collected
        run.evidence_by_order[step.order] = evidence
        run.findings_by_order[step.order] = findings
        run.metrics += metrics
        run.anomalies += anomalies

        run.messages += extra_messages
        if done.status == AgentTaskStatus.SUCCEEDED:
            reply_type = AgentMessageType.TASK_RESULT
            reply_payload: dict[str, Any] = {"status": done.status.value, "findings": len(findings)}
        else:
            reply_type = AgentMessageType.ERROR
            reply_payload = {"error": done.error or done.status.value, "status": done.status.value}
        if transport is not None:
            reply_payload["transport"] = transport
        run.messages.append(
            RunMessage(
                id=uuid4(),
                type=reply_type,
                agentTaskId=task_id,
                fromAgent=step.agent_type.value,
                toAgent=_COORDINATOR,
                payload=reply_payload,
                correlationId=str(task_id),
                createdAt=_now(),
            )
        )

        if done.status == AgentTaskStatus.SUCCEEDED:
            await self._report(
                inv.id,
                event_type="task.completed",
                payload={"taskId": str(task_id), "findings": len(findings)},
            )
        else:
            await self._report(
                inv.id,
                event_type="task.failed",
                payload={"taskId": str(task_id), "error": done.error or done.status.value},
            )
        run.tasks[step.order] = RunTask(
            id=task_id,
            stepId=step.id,
            agentType=step.agent_type,
            status=done.status,
            objective=step.objective,
            inputContext=input_context,
            result=done.result,
            error=done.error,
            startedAt=done.started_at,
            completedAt=done.completed_at,
            timeoutMs=agent_task.timeout_ms,
        )

    async def _run_synthesis(self, step: RunStep, steps: list[RunStep], run: _Run) -> None:
        inv = run.request.investigation
        domain = [
            run.tasks[s.order] for s in steps
            if s.agent_type != AgentType.COORDINATOR and s.order in run.tasks
        ]
        if not any(t.status == AgentTaskStatus.SUCCEEDED for t in domain):
            run.tasks[step.order] = self._skipped(
                step, run, "Skipped: no domain agent task succeeded, so there is nothing to "
                "synthesize."
            )
            return

        task_id = uuid4()
        started = _now()
        # The synthesis context sees every domain step, not only direct dependencies.
        all_orders = [s.order for s in steps if s.agent_type != AgentType.COORDINATOR]
        synthesis_view = step.model_copy(update={"depends_on": all_orders})
        assemble_request = ContextAssembleRequest(
            investigation=inv.model_dump(mode="json", by_alias=True),
            agentTaskId=task_id,
            agentType=AgentType.COORDINATOR,
            step=ContextStep(order=step.order, objective=step.objective),
            requirements=ContextRequirements(includeHistory=False),
            dataSources=run.request.data_sources,
            upstream=self._upstream(synthesis_view, run),
        )
        context = assemble_locally(
            assemble_request, inv, source="coordinator",
            reason="Synthesis context assembled by the Coordinator from every domain step's "
            "findings and evidence.",
        )
        input_context = await self._record_context(step, task_id, context, run)
        await self._report(
            inv.id,
            event_type="task.dispatched",
            payload={"taskId": str(task_id), "agentType": _COORDINATOR,
                     "objective": step.objective},
        )

        findings = [f for o in all_orders for f in run.findings_by_order.get(o, [])]
        evidence = [e for o in all_orders for e in run.evidence_by_order.get(o, [])]
        metric_key = (inv.trigger_context or {}).get("metricKey")
        outcome = synthesize_root_cause(
            findings, evidence, synthesis_task_id=task_id, metric_key=metric_key
        )
        own_evidence = [outcome.ranking_evidence]
        own_findings = [outcome.root] if outcome.synthesized and outcome.root else []
        run.evidence_by_order[step.order] = own_evidence
        run.findings_by_order[step.order] = own_findings
        run.outcome = outcome
        run.meta["rootCauseMethod"] = outcome.method

        result = {
            "evidence": [e.model_dump(mode="json", by_alias=True) for e in own_evidence],
            "findings": [f.model_dump(mode="json", by_alias=True) for f in own_findings],
            "metrics": [],
            "anomalies": [],
            "plan": {
                "reasoning": (
                    f"Ranked {len(outcome.candidates)} root-cause candidate(s) "
                    f"({outcome.method})."
                ),
            },
        }
        run.tasks[step.order] = RunTask(
            id=task_id,
            stepId=step.id,
            agentType=AgentType.COORDINATOR,
            status=AgentTaskStatus.SUCCEEDED,
            objective=step.objective,
            inputContext=input_context,
            result=result,
            startedAt=started,
            completedAt=_now(),
            timeoutMs=self.task_timeout_ms,
        )
        await self._report(
            inv.id,
            event_type="task.completed",
            payload={"taskId": str(task_id), "findings": len(own_findings)},
        )

    # ------------------------------------------------------------------
    # LLM summary
    # ------------------------------------------------------------------

    async def _llm_summary(self, run: _Run, rules_summary: str, **inputs: Any) -> str:
        if self._llm is None:
            return rules_summary
        run.meta["llmModel"] = getattr(self._llm, "model", None)
        user, allowed = summary_inputs(question=run.request.investigation.question, **inputs)
        run.meta["llmCalls"] += 1
        try:
            raw = await self._llm.complete_json(
                system=LLM_SUMMARY_SYSTEM, user=user, schema=SUMMARY_SCHEMA, max_tokens=2000
            )
            summary = str(raw.get("summary") or "").strip()
            if not summary:
                raise ValueError("empty summary")
            invented = summary_numbers_ok(summary, allowed)
            if invented:
                raise ValueError(
                    f"summary contains numbers not in the findings: {', '.join(invented)}"
                )
        except Exception as exc:  # any failure -> the rules summary
            logger.warning("LLM summary rejected, using rules: %s", exc)
            run.meta["llmErrors"].append(f"summary: {exc}")
            return rules_summary
        run.meta["summaryWriter"] = "llm"
        return summary

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _transport(task: AgentTask) -> str | None:
        if isinstance(task.result, dict) and task.result.get("transport"):
            return str(task.result["transport"])
        value = getattr(task, "transport", None)
        return str(value) if value else None

    @staticmethod
    def _extra_messages(task: AgentTask) -> list[RunMessage]:
        if not isinstance(task.result, dict) or "_messages" not in task.result:
            return []
        raw = task.result.pop("_messages") or []
        out: list[RunMessage] = []
        for item in raw if isinstance(raw, list) else []:
            try:
                message = RunMessage.model_validate(item)
            except ValidationError:
                logger.warning("Dropping invalid A2A message from task %s", task.id)
                continue
            message.agent_task_id = message.agent_task_id or task.id
            out.append(message)
        return out

    async def _dispatch_with_timeout(self, task: AgentTask) -> AgentTask:
        dispatched_at = _now()
        timeout_s = task.timeout_ms / 1000
        try:
            done = await asyncio.wait_for(self._dispatch(task.model_copy(deep=True)), timeout_s)
        except TimeoutError:
            failed = task.model_copy(deep=True)
            failed.status = AgentTaskStatus.TIMED_OUT
            failed.error = f"{task.agent_type.value} task timed out after {timeout_s:g}s."
            failed.started_at = dispatched_at
            failed.completed_at = _now()
            return failed
        except Exception as exc:  # dispatch failures become task failures, never raise
            logger.exception("Dispatch of task %s failed", task.id)
            failed = task.model_copy(deep=True)
            failed.status = AgentTaskStatus.FAILED
            failed.error = f"Dispatch to {task.agent_type.value} failed: {exc}"
            failed.started_at = dispatched_at
            failed.completed_at = _now()
            return failed

        # Keep the Coordinator's ids authoritative whatever the agent returned.
        done.id = task.id
        done.investigation_id = task.investigation_id
        done.started_at = done.started_at or dispatched_at
        done.completed_at = done.completed_at or _now()
        if done.status not in _TERMINAL:
            done.error = done.error or f"Agent returned non-terminal status {done.status.value}."
            done.status = AgentTaskStatus.FAILED
        return done

    def _collect(self, task: AgentTask):
        """Parse a successful task's result lists; None if they don't validate."""
        if task.status != AgentTaskStatus.SUCCEEDED:
            return [], [], [], []
        result = task.result or {}
        try:
            evidence = [RunEvidence.model_validate(e) for e in result.get("evidence") or []]
            findings = [RunFinding.model_validate(f) for f in result.get("findings") or []]
            metrics = [RunMetric.model_validate(m) for m in result.get("metrics") or []]
            anomalies = [RunAnomaly.model_validate(a) for a in result.get("anomalies") or []]
        except ValidationError:
            logger.exception("Task %s returned an invalid result", task.id)
            return None
        # Never let a record point at something that isn't in this result.
        evidence_ids = {e.id for e in evidence}
        metric_ids = {m.id for m in metrics}
        for item in evidence:
            item.agent_task_id = task.id
            item.source.agent_task_id = task.id
        for finding in findings:
            finding.agent_task_id = task.id
            finding.is_root_cause = False
            finding.evidence_ids = [i for i in finding.evidence_ids if i in evidence_ids]
        for anomaly in anomalies:
            if anomaly.metric_id not in metric_ids:
                anomaly.metric_id = None
        return evidence, findings, metrics, anomalies

    async def _report(
        self,
        investigation_id: UUID,
        *,
        status: str | None = None,
        event_type: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        try:
            await self._progress.report(
                investigation_id, status=status, event_type=event_type, payload=payload
            )
        except Exception:  # progress is best effort, never fatal
            logger.warning(
                "Progress report failed for investigation %s (%s)",
                investigation_id,
                event_type or status,
                exc_info=True,
            )
