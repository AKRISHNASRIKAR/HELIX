"""The Analytics Agent (Phase 4, extended in Phase 7): the first concrete BaseAgent.

execute() = plan (planner.py) -> call analytics-engine tools -> wrap the
engine's structured output as Metric/Anomaly records, Evidence, and Findings
(records.py). The agent never computes a statistic itself (ADR-005); it
selects, links, and formats what the engine returned. Confidence is derived
from the engine's own statistics (see formatting.confidence_from_*).

Phase 7 adds a segment step: the top-ranked HIGH/CRITICAL anomaly is broken
down with /segments/compare, and a `segment` evidence + DIAGNOSTIC finding is
recorded when the engine names a slice that explains the move.

task.result is shaped so the Coordinator can drop its lists straight into an
InvestigationRunResult (helix_contracts.investigation_run):
    { evidence, findings, metrics, anomalies, toolCalls, analysisPlan, plan, warnings,
      anomalyCount }
(`plan` is the same dict as `analysisPlan`, incl. `reasoning`.)
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentCapability,
    AgentTask,
    AgentTaskStatus,
    AgentType,
    AnalyticsType,
    BaseAgent,
    ContextRequirements,
    DataSourceContext,
    EvidenceSourceType,
    RunEvidence,
    RunFinding,
    RunMetric,
)

from . import __version__
from .engine_client import AnalyticsEngineClient, AnalyticsEngineError, ToolCallLog
from .formatting import (
    confidence_from_mape,
    confidence_from_segment,
    format_date,
    format_value,
    parse_timestamp,
)
from .planner import (
    AnalysisPlan,
    NoUsableDatasetError,
    find_table,
    pick_segment_dimensions,
    plan_analysis,
)
from .records import (
    Outputs,
    Recorder,
    anomaly_direction,
    best_slice,
    now,
    rank_anomalies,
    segment_data,
    segment_statement,
)
from .task_context import TaskContext, parse_task_context

logger = logging.getLogger(__name__)

CAPABILITIES = [
    AgentCapability(
        name="kpi_analysis",
        description="Computes a KPI over the latest window and compares it with the previous one.",
    ),
    AgentCapability(
        name="trend_analysis",
        description="Builds the metric's daily series and period-over-period change.",
    ),
    AgentCapability(
        name="anomaly_detection",
        description="Finds anomalous days in the metric's daily series (robust z-score / STL).",
    ),
    AgentCapability(
        name="forecasting",
        description="Forecasts the metric's daily series with a holdout backtest.",
    ),
]

_now = now


class AnalyticsAgent(BaseAgent):
    agent_type = AgentType.ANALYTICS
    name = "Analytics Agent"
    description = (
        "Turns a question into analytics-engine calls (KPIs, anomaly detection, segment "
        "breakdown, forecasting) and returns evidence-backed findings."
    )
    version = __version__
    context_requirements = ContextRequirements(
        semanticTypes=["datetime", "currency", "numeric", "categorical", "identifier"],
        includeUpstream=False,
    )

    def __init__(
        self,
        engine: AnalyticsEngineClient | None = None,
        *,
        kpi_window_days: int = 7,
        forecast_horizon: int = 14,
        max_anomalies: int = 3,
    ):
        self.engine = engine or AnalyticsEngineClient()
        self.kpi_window_days = kpi_window_days
        self.forecast_horizon = forecast_horizon
        self.max_anomalies = max_anomalies

    @property
    def capabilities(self) -> list[AgentCapability]:
        return list(CAPABILITIES)

    # ------------------------------------------------------------------
    # BaseAgent boundary: never raises
    # ------------------------------------------------------------------

    async def execute(self, task: AgentTask) -> AgentTask:
        task = task.model_copy(deep=True)
        task.status = AgentTaskStatus.RUNNING
        task.started_at = task.started_at or _now()
        task.error = None
        log = ToolCallLog()
        plan: AnalysisPlan | None = None
        try:
            ctx = parse_task_context(task)
            plan = plan_analysis(ctx.question, ctx.data_sources, objective=task.objective)
            outputs = await self._run(task, ctx, plan, log)
        except (AnalyticsEngineError, NoUsableDatasetError) as exc:
            return self._fail(task, str(exc), log, plan)
        except Exception as exc:  # the BaseAgent boundary must never raise
            logger.exception("Analytics Agent failed unexpectedly on task %s", task.id)
            return self._fail(task, f"Unexpected Analytics Agent error: {exc}", log, plan)

        summary = plan.summary()
        task.result = {
            **outputs.dump(),
            "toolCalls": log.to_list(),
            "analysisPlan": summary,
            "plan": summary,
        }
        task.status = AgentTaskStatus.SUCCEEDED
        task.completed_at = _now()
        return task

    def _fail(
        self, task: AgentTask, error: str, log: ToolCallLog, plan: AnalysisPlan | None
    ) -> AgentTask:
        task.status = AgentTaskStatus.FAILED
        task.error = error
        summary = plan.summary() if plan else None
        task.result = {"toolCalls": log.to_list(), "analysisPlan": summary, "plan": summary}
        task.completed_at = _now()
        return task

    # ------------------------------------------------------------------
    # Tool calls
    # ------------------------------------------------------------------

    async def _run(
        self, task: AgentTask, ctx: TaskContext, plan: AnalysisPlan, log: ToolCallLog
    ) -> Outputs:
        dataset = {
            "dataSourceId": plan.dataset.data_source_id,
            "organizationId": ctx.organization_id,
            "table": plan.dataset.table,
        }
        rec = Recorder(task.id, AgentType.ANALYTICS)

        kpi_response = await self.engine.kpis(
            {
                "dataset": dataset,
                "timeColumn": plan.dataset.time_column,
                "kpis": [plan.kpi_spec],
                "windowDays": self.kpi_window_days,
            },
            log,
        )
        anomaly_response = await self.engine.detect_anomalies(
            {
                "dataset": dataset,
                **plan.series_spec,
                "method": "auto",
                "metricName": plan.intent.series_label or plan.intent.key,
            },
            log,
        )
        self._add_kpis(rec, plan, kpi_response)
        top = self._add_anomalies(rec, plan, anomaly_response)
        if top is not None:
            await self._add_segment(rec, plan, ctx.data_sources, dataset, top, log)

        if plan.forecast:
            try:
                forecast_response = await self.engine.forecast(
                    {"dataset": dataset, **plan.series_spec, "horizon": self.forecast_horizon},
                    log,
                )
            except AnalyticsEngineError as exc:
                # A forecast is a nice-to-have; KPIs and anomalies still stand.
                rec.out.warnings.append(f"Forecast skipped: {exc}")
            else:
                self._add_forecast(rec, plan, forecast_response)
        return rec.out

    # ------------------------------------------------------------------
    # Engine output -> records, evidence, findings
    # ------------------------------------------------------------------

    def _source(self, task_id: UUID, plan: AnalysisPlan, description: str) -> dict[str, Any]:
        return {
            "dataSourceId": plan.dataset.data_source_id,
            "agentTaskId": task_id,
            "description": description,
        }

    def _add_kpis(
        self, rec: Recorder, plan: AnalysisPlan, response: dict[str, Any]
    ) -> None:
        intent = plan.intent
        for raw in response.get("metrics") or []:
            rec.kpi(
                data_source_id=plan.dataset.data_source_id,
                table=plan.dataset.table,
                raw=raw,
                metric_key=intent.key,
                label=intent.label,
                unit=intent.unit,
                window_days=self.kpi_window_days,
            )

    def _add_anomalies(
        self, rec: Recorder, plan: AnalysisPlan, response: dict[str, Any]
    ) -> tuple[dict[str, Any], RunEvidence] | None:
        """Records the top N anomalies; returns (raw, evidence) of the top-ranked one."""
        out = rec.out
        intent = plan.intent
        label = intent.series_label or intent.label
        unit = intent.series_unit if intent.series_label else intent.unit
        raw_metric = response.get("metric")
        if not raw_metric:
            out.warnings.append("Anomaly detection returned no metric series.")
            return None
        series_metric = rec.metric(
            plan.dataset.data_source_id, raw_metric, name=f"{label} (daily)", unit=unit
        )
        out.metrics.append(series_metric)

        detected = response.get("anomalies") or []
        out.anomaly_count = len(detected)
        method_used = response.get("methodUsed") or "auto"
        top: tuple[dict[str, Any], RunEvidence] | None = None
        for raw in rank_anomalies(detected, plan.direction_hint, self.max_anomalies):
            evidence, _ = rec.anomaly(
                data_source_id=plan.dataset.data_source_id,
                table=plan.dataset.table,
                raw=raw,
                series_metric=series_metric,
                metric_key=intent.key,
                label=label,
                unit=unit,
                method_used=method_used,
            )
            top = top or (raw, evidence)
        return top

    async def _add_segment(
        self,
        rec: Recorder,
        plan: AnalysisPlan,
        sources: list[DataSourceContext],
        dataset: dict[str, Any],
        top: tuple[dict[str, Any], RunEvidence],
        log: ToolCallLog,
    ) -> None:
        """Segment step (Phase 7): where did the top HIGH/CRITICAL anomaly happen?

        Calls /segments/compare for the anomaly day with the same series spec and,
        only when the engine returns a topSlice, records `segment` evidence plus a
        DIAGNOSTIC finding. Confidence = anomaly confidence * concentration of the
        best dimension (formatting.confidence_from_segment). A failed call or a null
        topSlice records nothing but a warning / reasoning line (no fake claims).
        """
        raw, anomaly_evidence = top
        severity = str(raw.get("severity") or "").upper()
        if severity not in ("HIGH", "CRITICAL"):
            plan.reasoning.append(
                f"Top anomaly is {severity or 'unrated'} severity, so no segment breakdown was run."
            )
            return
        table = find_table(sources, plan.dataset.data_source_id, plan.dataset.table)
        exclude = [plan.dataset.time_column, plan.dataset.value_column or ""]
        if plan.dataset.filter:
            exclude.append(plan.dataset.filter["column"])
        dimensions = pick_segment_dimensions(table, exclude=exclude) if table else []
        if not dimensions:
            plan.reasoning.append(
                f"Table '{plan.dataset.table}' has no categorical columns to segment by."
            )
            return
        intent = plan.intent
        label = intent.series_label or intent.label
        unit = intent.series_unit if intent.series_label else intent.unit
        date = format_date(raw["timestamp"])
        body: dict[str, Any] = {
            "dataset": dataset,
            **plan.series_spec,
            "dimensions": dimensions,
            "targetDate": date,
            "baseline": "same_weekday",
            "baselinePeriods": 4,
            "metricName": label,
        }
        if unit:
            body["unit"] = unit
        try:
            response = await self.engine.compare_segments(body, log)
        except AnalyticsEngineError as exc:
            rec.out.warnings.append(f"Segment comparison skipped: {exc}")
            return
        top_slice, source = best_slice(response)
        if top_slice is None:
            plan.reasoning.append(
                f"Segment comparison for {date} found no single slice that explains the move."
            )
            return
        direction = anomaly_direction(raw)
        data = segment_data(
            response, kind="segment", metric_key=intent.key, metric_name=label, unit=unit,
            date=date, direction=direction, top_slice=top_slice, top_slice_source=source,
        )
        data["metricId"] = anomaly_evidence.data.get("metricId")
        data["anomalyEvidenceId"] = str(anomaly_evidence.id)
        statement = segment_statement(
            metric_label=label, date=date, direction=direction, top=top_slice, unit=unit
        )
        confidence = confidence_from_segment(anomaly_evidence.confidence, data["concentration"])
        evidence = rec.add_evidence(
            source_type=EvidenceSourceType.METRIC,
            data_source_id=plan.dataset.data_source_id,
            description=f"Segment breakdown of daily {label} on {date} from table "
            f"'{plan.dataset.table}' (analytics-engine /segments/compare)",
            summary=statement,
            data=data,
            confidence=confidence,
        )
        rec.add_finding(
            analytics_type=AnalyticsType.DIAGNOSTIC,
            statement=statement,
            confidence=confidence,
            evidence=[evidence],
        )

    def _add_forecast(
        self, rec: Recorder, plan: AnalysisPlan, response: dict[str, Any]
    ) -> None:
        task_id, out = rec.task_id, rec.out
        points = [p for p in response.get("forecast") or [] if p.get("value") is not None]
        if not points:
            out.warnings.append("Forecast returned no points.")
            return
        intent = plan.intent
        label = intent.series_label or intent.label
        unit = intent.series_unit if intent.series_label else intent.unit
        last = points[-1]
        method_used = response.get("methodUsed") or "auto"
        backtest = response.get("backtest") or {}
        mape = backtest.get("mape")
        metric = RunMetric(
            id=uuid4(),
            dataSourceId=plan.dataset.data_source_id,
            name=f"{label} forecast",
            unit=unit,
            value=last["value"],
            series=[
                {"timestamp": parse_timestamp(p["timestamp"]), "value": p["value"]}
                for p in points
            ],
            computationMethod=response.get("computationMethod") or f"forecast ({method_used})",
            computedAt=_now(),
        )
        out.metrics.append(metric)

        interval = ""
        if last.get("lower") is not None and last.get("upper") is not None:
            interval = (
                f" (prediction interval {format_value(last['lower'], unit)} to "
                f"{format_value(last['upper'], unit)})"
            )
        accuracy = (
            f"; backtest MAPE {mape:.1f}% over {backtest.get('holdoutDays', '?')} "
            "holdout days" if mape is not None else ""
        )
        statement = (
            f"Daily {label} is forecast at {format_value(last['value'], unit)} on "
            f"{format_date(last['timestamp'])}{interval}, {len(points)} days ahead using "
            f"{method_used}{accuracy}."
        )
        confidence = confidence_from_mape(mape)
        evidence = RunEvidence(
            id=uuid4(),
            agentTaskId=task_id,
            sourceType=EvidenceSourceType.METRIC,
            source=self._source(
                task_id, plan,
                f"Forecast of daily {label} from table '{plan.dataset.table}' "
                "(analytics-engine /forecast)",
            ),
            summary=statement,
            data={
                "kind": "forecast",
                "metricId": str(metric.id),
                "metricKey": intent.key,
                "metricName": label,
                "unit": unit,
                "methodUsed": method_used,
                "backtest": backtest,
                "forecast": points,
                "computationMethod": metric.computation_method,
            },
            confidence=confidence,
            collectedAt=_now(),
        )
        out.evidence.append(evidence)
        out.findings.append(
            RunFinding(
                id=uuid4(),
                agentTaskId=task_id,
                agentType=AgentType.ANALYTICS,
                analyticsType=AnalyticsType.PREDICTIVE,
                statement=statement,
                confidence=confidence,
                evidenceIds=[evidence.id],
            )
        )
