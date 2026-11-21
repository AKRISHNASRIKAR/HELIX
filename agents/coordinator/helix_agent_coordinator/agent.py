"""The Coordinator Agent (Phase 5).

run_investigation() is the whole vertical slice:
    question -> plan (planner.py) -> one AgentTask per step -> dispatch ->
    collect -> synthesize (synthesis.py) -> InvestigationRunResult

The Coordinator never imports another agent. It hands each AgentTask to an
injected `dispatch` callable (agent-runtime wires it to the registered agent
in-process for Phase 5; Phase 7 can route it over A2A instead) and reports
live progress through an injected ProgressReporter.
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
    AgentTask,
    AgentTaskStatus,
    AgentType,
    BaseAgent,
    InvestigationRunRequest,
    InvestigationRunResult,
    RunAnomaly,
    RunEvidence,
    RunFinding,
    RunMetric,
    RunStep,
    RunTask,
)
from pydantic import ValidationError

from . import __version__
from .planner import build_plan
from .progress import NullProgressReporter, ProgressReporter
from .synthesis import (
    build_recommendations,
    build_summary,
    overall_confidence,
    run_status,
    select_root_cause,
)

logger = logging.getLogger(__name__)

Dispatch = Callable[[AgentTask], Awaitable[AgentTask]]

CAPABILITIES = [
    AgentCapability(
        name="investigation_planning",
        description="Turns a question into an InvestigationPlan of agent steps.",
    ),
    AgentCapability(
        name="task_delegation",
        description="Dispatches one AgentTask per plan step and collects the results.",
    ),
    AgentCapability(
        name="synthesis",
        description="Selects the root cause, overall confidence, summary, and recommendations.",
    ),
]


def _now() -> datetime:
    return datetime.now(UTC)


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
    ):
        self._dispatch = dispatch
        self._progress = progress or NullProgressReporter()
        self.task_timeout_ms = task_timeout_ms

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
        await self._report(
            inv.id,
            status="PLANNING",
            event_type="investigation.planning",
            payload={"question": inv.question},
        )
        plan = build_plan(inv.question, request.data_sources)
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

        tasks: list[RunTask] = []
        outcome_by_order: dict[int, AgentTaskStatus] = {}
        evidence: list[RunEvidence] = []
        findings: list[RunFinding] = []
        metrics: list[RunMetric] = []
        anomalies: list[RunAnomaly] = []

        for step in steps:
            agent_task = AgentTask(
                id=uuid4(),
                investigationId=inv.id,
                agentType=step.agent_type,
                status=AgentTaskStatus.QUEUED,
                objective=step.objective,
                inputContext=self._input_context(request, step),
                timeoutMs=self.task_timeout_ms,
            )
            blocked = [
                d for d in step.depends_on
                if outcome_by_order.get(d) != AgentTaskStatus.SUCCEEDED
            ]
            if blocked:
                agent_task.status = AgentTaskStatus.SKIPPED
                agent_task.error = f"Skipped: depends on unsuccessful step(s) {blocked}."
                done = agent_task
            else:
                await self._report(
                    inv.id,
                    event_type="task.dispatched",
                    payload={
                        "taskId": str(agent_task.id),
                        "agentType": step.agent_type.value,
                        "objective": step.objective,
                    },
                )
                done = await self._dispatch_with_timeout(agent_task)
                collected = self._collect(done)
                if collected is None:
                    done.status = AgentTaskStatus.FAILED
                    done.error = done.error or "Agent returned a result that is not valid."
                else:
                    evidence += collected[0]
                    findings += collected[1]
                    metrics += collected[2]
                    anomalies += collected[3]

            outcome_by_order[step.order] = done.status
            if done.status == AgentTaskStatus.SUCCEEDED:
                n = sum(1 for f in findings if f.agent_task_id == done.id)
                await self._report(
                    inv.id,
                    event_type="task.completed",
                    payload={"taskId": str(done.id), "findings": n},
                )
            else:
                await self._report(
                    inv.id,
                    event_type="task.failed",
                    payload={"taskId": str(done.id), "error": done.error or done.status.value},
                )
            tasks.append(
                RunTask(
                    id=done.id,
                    stepId=step.id,
                    agentType=step.agent_type,
                    status=done.status,
                    objective=step.objective,
                    inputContext=agent_task.input_context,
                    result=done.result,
                    error=done.error,
                    startedAt=done.started_at,
                    completedAt=done.completed_at,
                    timeoutMs=agent_task.timeout_ms,
                )
            )

        status = run_status(tasks)
        root = select_root_cause(findings)
        if root is not None:
            root.is_root_cause = True
        confidence = overall_confidence(findings, root)
        evidence_by_id = {e.id: e for e in evidence}
        result = InvestigationRunResult(
            status=status,
            plan=plan,
            steps=steps,
            tasks=tasks,
            evidence=evidence,
            findings=findings,
            recommendations=build_recommendations(findings, evidence_by_id, root),
            metrics=metrics,
            anomalies=anomalies,
            summary=build_summary(status, tasks, findings, root, confidence),
            overallConfidence=confidence,
            rootCauseFindingId=root.id if root else None,
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
    # Helpers
    # ------------------------------------------------------------------

    def _input_context(self, request: InvestigationRunRequest, step: RunStep) -> dict[str, Any]:
        """Hand-assembled context (no context engine until Phase 6)."""
        inv = request.investigation
        return {
            "question": inv.question,
            "investigationId": str(inv.id),
            "organizationId": str(inv.organization_id),
            "projectId": str(inv.project_id),
            "triggerType": inv.trigger_type.value,
            "step": {"order": step.order, "objective": step.objective},
            "dataSources": [
                source.model_dump(mode="json", by_alias=True) for source in request.data_sources
            ],
        }

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
        if done.status not in (
            AgentTaskStatus.SUCCEEDED,
            AgentTaskStatus.FAILED,
            AgentTaskStatus.TIMED_OUT,
        ):
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
