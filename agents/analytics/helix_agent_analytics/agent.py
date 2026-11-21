"""The Analytics Agent (Phase 4): the first concrete BaseAgent.

execute() = plan (planner.py) -> call analytics-engine tools -> wrap the
engine's structured output as Metric/Anomaly records, Evidence, and Findings.
The agent never computes a statistic itself (ADR-005); it selects, links, and
formats what the engine returned. Confidence is derived from the engine's own
statistics (see formatting.confidence_from_*).

task.result is shaped so the Coordinator can drop its lists straight into an
InvestigationRunResult (helix_contracts.investigation_run):
    { evidence, findings, metrics, anomalies, toolCalls, analysisPlan, warnings, anomalyCount }
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentCapability,
    AgentTask,
    AgentTaskStatus,
    AgentType,
    AnalyticsType,
    BaseAgent,
    DataSourceContext,
    EvidenceSourceType,
    RunAnomaly,
    RunEvidence,
    RunFinding,
    RunMetric,
)
from pydantic import ValidationError

from . import __version__
from .engine_client import AnalyticsEngineClient, AnalyticsEngineError, ToolCallLog
from .formatting import (
    capitalize,
    confidence_from_deviation,
    confidence_from_mape,
    confidence_from_p_value,
    format_date,
    format_day,
    format_percent_change,
    format_value,
    parse_timestamp,
)
from .planner import AnalysisPlan, NoUsableDatasetError, plan_analysis

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


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class _Outputs:
    """Accumulates result records; dumped into task.result at the end."""

    evidence: list[RunEvidence] = field(default_factory=list)
    findings: list[RunFinding] = field(default_factory=list)
    metrics: list[RunMetric] = field(default_factory=list)
    anomalies: list[RunAnomaly] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    anomaly_count: int = 0

    def dump(self) -> dict[str, Any]:
        def items(models):
            return [m.model_dump(mode="json", by_alias=True) for m in models]

        return {
            "evidence": items(self.evidence),
            "findings": items(self.findings),
            "metrics": items(self.metrics),
            "anomalies": items(self.anomalies),
            "warnings": self.warnings,
            "anomalyCount": self.anomaly_count,
        }


class AnalyticsAgent(BaseAgent):
    agent_type = AgentType.ANALYTICS
    name = "Analytics Agent"
    description = (
        "Turns a question into analytics-engine calls (KPIs, anomaly detection, forecasting) "
        "and returns evidence-backed findings."
    )
    version = __version__

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
            plan = self._plan(task)
            outputs = await self._run(task, plan, log)
        except (AnalyticsEngineError, NoUsableDatasetError) as exc:
            return self._fail(task, str(exc), log, plan)
        except Exception as exc:  # the BaseAgent boundary must never raise
            logger.exception("Analytics Agent failed unexpectedly on task %s", task.id)
            return self._fail(task, f"Unexpected Analytics Agent error: {exc}", log, plan)

        task.result = {
            **outputs.dump(),
            "toolCalls": log.to_list(),
            "analysisPlan": plan.summary(),
        }
        task.status = AgentTaskStatus.SUCCEEDED
        task.completed_at = _now()
        return task

    def _fail(
        self, task: AgentTask, error: str, log: ToolCallLog, plan: AnalysisPlan | None
    ) -> AgentTask:
        task.status = AgentTaskStatus.FAILED
        task.error = error
        task.result = {
            "toolCalls": log.to_list(),
            "analysisPlan": plan.summary() if plan else None,
        }
        task.completed_at = _now()
        return task

    # ------------------------------------------------------------------
    # Planning + tool calls
    # ------------------------------------------------------------------

    def _plan(self, task: AgentTask) -> AnalysisPlan:
        ctx = task.input_context or {}
        question = str(ctx.get("question") or task.objective)
        try:
            sources = [DataSourceContext.model_validate(s) for s in ctx.get("dataSources") or []]
        except ValidationError as exc:
            raise NoUsableDatasetError(
                f"inputContext.dataSources is malformed: {exc.error_count()} validation error(s)."
            ) from exc
        if not ctx.get("organizationId"):
            raise NoUsableDatasetError(
                "inputContext.organizationId is required to fetch data for analysis."
            )
        return plan_analysis(question, sources, objective=task.objective)

    async def _run(self, task: AgentTask, plan: AnalysisPlan, log: ToolCallLog) -> _Outputs:
        ctx = task.input_context
        dataset = {
            "dataSourceId": plan.dataset.data_source_id,
            "organizationId": str(ctx["organizationId"]),
            "table": plan.dataset.table,
        }
        out = _Outputs()

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
        forecast_response = None
        if plan.forecast:
            try:
                forecast_response = await self.engine.forecast(
                    {"dataset": dataset, **plan.series_spec, "horizon": self.forecast_horizon},
                    log,
                )
            except AnalyticsEngineError as exc:
                # A forecast is a nice-to-have; KPIs and anomalies still stand.
                out.warnings.append(f"Forecast skipped: {exc}")

        self._add_kpis(task.id, plan, kpi_response, out)
        self._add_anomalies(task.id, plan, anomaly_response, out)
        if forecast_response is not None:
            self._add_forecast(task.id, plan, forecast_response, out)
        return out

    # ------------------------------------------------------------------
    # Engine output -> records, evidence, findings
    # ------------------------------------------------------------------

    def _source(self, task_id: UUID, plan: AnalysisPlan, description: str) -> dict[str, Any]:
        return {
            "dataSourceId": plan.dataset.data_source_id,
            "agentTaskId": task_id,
            "description": description,
        }

    def _metric(
        self, plan: AnalysisPlan, raw: dict[str, Any], *, name: str, unit: str | None
    ) -> RunMetric:
        series = [
            {"timestamp": parse_timestamp(p["timestamp"]), "value": p["value"]}
            for p in raw.get("series") or []
            if p.get("value") is not None
        ]
        return RunMetric(
            id=uuid4(),
            dataSourceId=plan.dataset.data_source_id,
            name=name,
            unit=raw.get("unit") or unit,
            value=raw["value"],
            baseline=raw.get("baseline"),
            changePercent=raw.get("changePercent"),
            series=series or None,
            computationMethod=raw.get("computationMethod") or "analytics-engine",
            computedAt=parse_timestamp(raw["computedAt"]) if raw.get("computedAt") else _now(),
        )

    def _add_kpis(
        self, task_id: UUID, plan: AnalysisPlan, response: dict[str, Any], out: _Outputs
    ) -> None:
        intent = plan.intent
        for raw in response.get("metrics") or []:
            metric = self._metric(plan, raw, name=raw.get("name") or intent.key, unit=intent.unit)
            out.metrics.append(metric)
            unit = metric.unit
            window = raw.get("window") or {}
            days = self.kpi_window_days
            end = format_date(window["currentEnd"]) if window.get("currentEnd") else None
            value_text = format_value(metric.value, unit)
            baseline_text = format_value(metric.baseline, unit)
            period = f"the {days} days ending {end}" if end else f"the last {days} days"
            p_value = raw.get("pValue")
            confidence = confidence_from_p_value(p_value)

            if metric.change_percent is None or metric.baseline is None:
                statement = (
                    f"Over {period}, {intent.label} came to {value_text}; "
                    "there is no comparable previous window."
                )
            else:
                direction = (
                    "up" if metric.change_percent > 0
                    else "down" if metric.change_percent < 0 else "flat"
                )
                change = (
                    f"{direction} {format_percent_change(metric.change_percent)}"
                    if direction != "flat" else "unchanged"
                )
                significance = (
                    f" (Welch t-test p = {p_value:.3g})" if p_value is not None
                    else " (significance not computable)"
                )
                statement = (
                    f"Over {period}, {intent.label} came to {value_text}, {change} "
                    f"from {baseline_text} in the previous {days} days{significance}."
                )

            evidence = RunEvidence(
                id=uuid4(),
                agentTaskId=task_id,
                sourceType=EvidenceSourceType.METRIC,
                source=self._source(
                    task_id, plan,
                    f"{capitalize(intent.label)} KPI from table '{plan.dataset.table}' "
                    "(analytics-engine /kpis)",
                ),
                summary=statement,
                data={
                    "kind": "kpi",
                    "metricId": str(metric.id),
                    "metricKey": intent.key,
                    "metricName": intent.label,
                    "unit": unit,
                    "value": metric.value,
                    "baseline": metric.baseline,
                    "changePercent": metric.change_percent,
                    "pValue": p_value,
                    "window": window,
                    "computationMethod": metric.computation_method,
                    "formatted": {
                        "value": value_text,
                        "baseline": baseline_text,
                        "changePercent": (
                            format_percent_change(metric.change_percent)
                            if metric.change_percent is not None else None
                        ),
                        "period": period,
                    },
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
                    analyticsType=AnalyticsType.DESCRIPTIVE,
                    statement=statement,
                    confidence=confidence,
                    evidenceIds=[evidence.id],
                )
            )

    def _rank_anomalies(
        self, plan: AnalysisPlan, anomalies: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Top N by |deviationScore|, anomalies matching the question's direction first."""

        def key(anomaly: dict[str, Any]):
            mismatch = (
                plan.direction_hint is not None and anomaly.get("direction") != plan.direction_hint
            )
            return (mismatch, -abs(anomaly.get("deviationScore") or 0.0))

        return sorted(anomalies, key=key)[: self.max_anomalies]

    def _add_anomalies(
        self, task_id: UUID, plan: AnalysisPlan, response: dict[str, Any], out: _Outputs
    ) -> None:
        intent = plan.intent
        label = intent.series_label or intent.label
        unit = intent.series_unit if intent.series_label else intent.unit
        raw_metric = response.get("metric")
        if not raw_metric:
            out.warnings.append("Anomaly detection returned no metric series.")
            return
        series_metric = self._metric(plan, raw_metric, name=f"{label} (daily)", unit=unit)
        out.metrics.append(series_metric)

        detected = response.get("anomalies") or []
        out.anomaly_count = len(detected)
        method_used = response.get("methodUsed") or "auto"
        for raw in self._rank_anomalies(plan, detected):
            score = raw.get("deviationScore")
            direction = raw.get("direction") or ("drop" if (score or 0) < 0 else "spike")
            severity = raw.get("severity") or "MEDIUM"
            when = parse_timestamp(raw["timestamp"])
            value_text = format_value(raw.get("value"), unit)
            expected_text = format_value(raw.get("expectedValue"), unit)
            detection = raw.get("detectionMethod") or method_used
            anomaly = RunAnomaly(
                id=uuid4(),
                metricId=series_metric.id,
                dataSourceId=plan.dataset.data_source_id,
                description=raw.get("description")
                or f"{capitalize(label)} {direction} on {format_date(when)}",
                severity=severity,
                detectedAt=when,
                detectionMethod=detection,
                value=raw["value"],
                expectedValue=raw.get("expectedValue"),
                deviationScore=score,
            )
            out.anomalies.append(anomaly)

            verb = "dropped" if direction == "drop" else "spiked"
            score_text = f"deviation score {score:+.1f}, " if score is not None else ""
            statement = (
                f"{capitalize(label)} {verb} on {format_day(when)}: {value_text} against "
                f"an expected {expected_text} ({score_text}{severity} severity, "
                f"detected by {detection})."
            )
            confidence = confidence_from_deviation(score)
            evidence = RunEvidence(
                id=uuid4(),
                agentTaskId=task_id,
                sourceType=EvidenceSourceType.ANOMALY,
                source=self._source(
                    task_id, plan,
                    f"Anomaly in daily {label} from table '{plan.dataset.table}' "
                    "(analytics-engine /anomalies/detect)",
                ),
                summary=anomaly.description,
                data={
                    "kind": "anomaly",
                    "anomalyId": str(anomaly.id),
                    "metricId": str(series_metric.id),
                    "metricKey": intent.key,
                    "metricName": label,
                    "unit": unit,
                    "timestamp": when.isoformat(),
                    "date": format_date(when),
                    "direction": direction,
                    "severity": severity,
                    "value": anomaly.value,
                    "expectedValue": anomaly.expected_value,
                    "deviationScore": score,
                    "detectionMethod": detection,
                    "formatted": {
                        "value": value_text,
                        "expectedValue": expected_text,
                        "day": format_day(when),
                    },
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
                    analyticsType=AnalyticsType.DIAGNOSTIC,
                    statement=statement,
                    confidence=confidence,
                    evidenceIds=[evidence.id],
                )
            )

    def _add_forecast(
        self, task_id: UUID, plan: AnalysisPlan, response: dict[str, Any], out: _Outputs
    ) -> None:
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
