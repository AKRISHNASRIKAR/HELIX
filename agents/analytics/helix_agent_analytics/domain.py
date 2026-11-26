"""Shared execute() boundary for the engine-backed domain agents.

FinanceAgent, CustomerAgent and ProductAgent subclass DomainAgent and only
implement `run()`. DomainAgent owns the BaseAgent contract: it never raises,
it parses the inputContext (AssembledContext or the Phase 5 subset) with
task_context.parse_task_context, and it reports results exactly like the
Analytics Agent:
    task.result = { evidence, findings, metrics, anomalies, warnings, anomalyCount,
                    toolCalls, analysisPlan: {..., reasoning}, plan: <same dict> }
Engine errors and unusable inputs become a FAILED task with a readable error.

This module is a helper base class, not an agent: domain agents import it
instead of importing the Analytics Agent itself.
"""

from __future__ import annotations

import logging
from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any

from helix_contracts import AgentTask, AgentTaskStatus, BaseAgent, DataSourceContext

from .engine_client import AnalyticsEngineClient, AnalyticsEngineError, ToolCallLog
from .planner import (
    INTENTS,
    DatasetChoice,
    NoUsableDatasetError,
    direction_hint,
    plan_analysis,
)
from .records import Outputs, Recorder, now, rank_anomalies
from .task_context import TaskContext, parse_task_context

logger = logging.getLogger(__name__)


@dataclass
class Focus:
    """The day(s) a dependent agent explains and the metric they are about."""

    dates: list[str]
    metric_key: str
    metric_label: str
    direction: str | None
    #: "context" (AssembledContext.focus), "detected" (own anomaly detection) or "none".
    source: str

    @property
    def move(self) -> str:
        """'drop' | 'spike' | 'change', for statements like 'the revenue drop'."""
        return self.direction if self.direction in ("drop", "spike") else "change"


@dataclass
class AgentRun:
    """Per-execute state handed to DomainAgent.run()."""

    task: AgentTask
    ctx: TaskContext
    log: ToolCallLog
    rec: Recorder
    reasoning: list[str] = field(default_factory=list)
    plan: dict[str, Any] = field(default_factory=dict)

    @property
    def out(self) -> Outputs:
        return self.rec.out

    def dataset(self, choice: DatasetChoice) -> dict[str, Any]:
        return {
            "dataSourceId": choice.data_source_id,
            "organizationId": self.ctx.organization_id,
            "table": choice.table,
        }

    def plan_summary(self) -> dict[str, Any]:
        return {**self.plan, "reasoning": list(self.reasoning)}


class DomainAgent(BaseAgent):
    """Base for engine-backed domain agents. Subclasses implement `run()`."""

    #: At most this many focus dates are explained per task.
    max_focus_dates = 2

    def __init__(self, engine: AnalyticsEngineClient | None = None):
        self.engine = engine or AnalyticsEngineClient()

    @abstractmethod
    async def run(self, run: AgentRun) -> None:
        """Call the engine and record evidence/findings on `run.rec`."""

    async def execute(self, task: AgentTask) -> AgentTask:
        task = task.model_copy(deep=True)
        task.status = AgentTaskStatus.RUNNING
        task.started_at = task.started_at or now()
        task.error = None
        log = ToolCallLog()
        run: AgentRun | None = None
        try:
            ctx = parse_task_context(task)
            run = AgentRun(task=task, ctx=ctx, log=log, rec=Recorder(task.id, self.agent_type))
            await self.run(run)
        except (AnalyticsEngineError, NoUsableDatasetError) as exc:
            return self._fail(task, str(exc), log, run)
        except Exception as exc:  # the BaseAgent boundary must never raise
            logger.exception("%s failed unexpectedly on task %s", self.name, task.id)
            return self._fail(task, f"Unexpected {self.name} error: {exc}", log, run)

        summary = run.plan_summary()
        task.result = {
            **run.out.dump(),
            "toolCalls": log.to_list(),
            "analysisPlan": summary,
            "plan": summary,
        }
        task.status = AgentTaskStatus.SUCCEEDED
        task.completed_at = now()
        return task

    def _fail(
        self, task: AgentTask, error: str, log: ToolCallLog, run: AgentRun | None
    ) -> AgentTask:
        summary = run.plan_summary() if run else None
        task.status = AgentTaskStatus.FAILED
        task.error = error
        task.result = {"toolCalls": log.to_list(), "analysisPlan": summary, "plan": summary}
        task.completed_at = now()
        return task

    # ------------------------------------------------------------------
    # Focus resolution
    # ------------------------------------------------------------------

    async def resolve_focus(
        self, run: AgentRun, data_sources: list[DataSourceContext] | None = None
    ) -> Focus:
        """Focus dates from AssembledContext.focus.anomalyDates, else the top anomaly
        of the focus metric from this agent's own /anomalies/detect call.

        The focus metric is the first focus.metricKeys entry the planner knows,
        else revenue. Returns source "none" (no dates) when no table can serve it.
        """
        ctx = run.ctx
        key = next((k for k in ctx.focus_metric_keys if k in INTENTS), "revenue")
        intent = INTENTS[key]
        label = ctx.upstream_metric_name(key) or intent.series_label or intent.label
        direction = ctx.focus_direction or direction_hint(ctx.question)
        if ctx.focus_dates:
            dates = ctx.focus_dates[: self.max_focus_dates]
            run.reasoning.append(
                f"Explaining {', '.join(dates)} ({label}) from the assembled context focus."
            )
            run.plan.update(focusSource="context", focusDates=dates, focusMetric=key)
            return Focus(dates, key, label, direction, "context")

        sources = ctx.data_sources if data_sources is None else data_sources
        try:
            plan = plan_analysis(intent.label, sources)
        except NoUsableDatasetError as exc:
            run.reasoning.append(
                f"No focus dates in the context and no table to detect {label} anomalies on: {exc}"
            )
            run.plan.update(focusSource="none", focusDates=[], focusMetric=key)
            return Focus([], key, label, direction, "none")
        label = plan.intent.series_label or plan.intent.label
        response = await self.engine.detect_anomalies(
            {
                "dataset": run.dataset(plan.dataset),
                **plan.series_spec,
                "method": "auto",
                "metricName": label,
            },
            run.log,
        )
        ranked = rank_anomalies(response.get("anomalies") or [], direction, 1)
        if not ranked:
            run.reasoning.append(
                f"No focus dates in the context and no {label} anomaly was detected, "
                "so there is no day to explain."
            )
            run.plan.update(focusSource="none", focusDates=[], focusMetric=plan.intent.key)
            return Focus([], plan.intent.key, label, direction, "none")
        top = ranked[0]
        date = str(top.get("timestamp"))[:10]
        direction = direction or top.get("direction")
        run.reasoning.append(
            f"No focus dates in the context; detected the top {label} anomaly on {date} "
            f"in table '{plan.dataset.table}' and explain that day."
        )
        run.plan.update(focusSource="detected", focusDates=[date], focusMetric=plan.intent.key)
        return Focus([date], plan.intent.key, label, direction, "detected")
