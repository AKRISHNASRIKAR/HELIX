"""Engine output -> Metric/Anomaly records, Evidence and Findings.

Shared by the Analytics Agent and the domain agents (Finance, Customer,
Product) so every agent reports results in the same shape:
    task.result = { evidence, findings, metrics, anomalies, warnings, anomalyCount, ... }
with list items already in InvestigationRunResult shape (camelCase JSON).
Nothing here computes a statistic (ADR-005): numbers are copied from engine
responses and formatted, and every number placed in a statement is also put
in the evidence `data` (usually `data.formatted`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentType,
    AnalyticsType,
    EvidenceSourceType,
    RunAnomaly,
    RunEvidence,
    RunFinding,
    RunMetric,
)

from .formatting import (
    capitalize,
    confidence_from_deviation,
    confidence_from_p_value,
    format_date,
    format_day,
    format_percent_change,
    format_share,
    format_signed_percent,
    format_value,
    parse_timestamp,
)


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Outputs:
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


def rank_anomalies(
    anomalies: list[dict[str, Any]], direction: str | None, limit: int
) -> list[dict[str, Any]]:
    """Top `limit` by |deviationScore|, anomalies matching `direction` first."""

    def key(anomaly: dict[str, Any]):
        mismatch = direction is not None and anomaly.get("direction") != direction
        return (mismatch, -abs(anomaly.get("deviationScore") or 0.0))

    return sorted(anomalies, key=key)[:limit]


def anomaly_direction(raw: dict[str, Any]) -> str:
    score = raw.get("deviationScore")
    return raw.get("direction") or ("drop" if (score or 0) < 0 else "spike")


class Recorder:
    """Builds linked records for one task and appends them to `out`."""

    def __init__(self, task_id: UUID, agent_type: AgentType, out: Outputs | None = None):
        self.task_id = task_id
        self.agent_type = agent_type
        self.out = out or Outputs()

    # -- generic -----------------------------------------------------------

    def source(self, data_source_id: str | None, description: str) -> dict[str, Any]:
        return {
            "dataSourceId": data_source_id,
            "agentTaskId": self.task_id,
            "description": description,
        }

    def add_evidence(
        self,
        *,
        source_type: EvidenceSourceType,
        data_source_id: str | None,
        description: str,
        summary: str,
        data: dict[str, Any],
        confidence: float,
    ) -> RunEvidence:
        evidence = RunEvidence(
            id=uuid4(),
            agentTaskId=self.task_id,
            sourceType=source_type,
            source=self.source(data_source_id, description),
            summary=summary,
            data=data,
            confidence=confidence,
            collectedAt=now(),
        )
        self.out.evidence.append(evidence)
        return evidence

    def add_finding(
        self,
        *,
        analytics_type: AnalyticsType,
        statement: str,
        confidence: float,
        evidence: list[RunEvidence],
    ) -> RunFinding:
        finding = RunFinding(
            id=uuid4(),
            agentTaskId=self.task_id,
            agentType=self.agent_type,
            analyticsType=analytics_type,
            statement=statement,
            confidence=confidence,
            evidenceIds=[e.id for e in evidence],
        )
        self.out.findings.append(finding)
        return finding

    def metric(
        self, data_source_id: str | None, raw: dict[str, Any], *, name: str, unit: str | None
    ) -> RunMetric:
        """A RunMetric from an engine MetricOut (not appended; callers decide)."""
        series = [
            {"timestamp": parse_timestamp(p["timestamp"]), "value": p["value"]}
            for p in raw.get("series") or []
            if p.get("value") is not None
        ]
        return RunMetric(
            id=uuid4(),
            dataSourceId=data_source_id,
            name=name,
            unit=raw.get("unit") or unit,
            value=raw["value"],
            baseline=raw.get("baseline"),
            changePercent=raw.get("changePercent"),
            series=series or None,
            computationMethod=raw.get("computationMethod") or "analytics-engine",
            computedAt=parse_timestamp(raw["computedAt"]) if raw.get("computedAt") else now(),
        )

    # -- KPI -----------------------------------------------------------------

    def kpi(
        self,
        *,
        data_source_id: str,
        table: str,
        raw: dict[str, Any],
        metric_key: str,
        label: str,
        unit: str | None,
        window_days: int,
    ) -> None:
        """KPI metric + `kpi` evidence + DESCRIPTIVE finding (confidence 1 - pValue)."""
        metric = self.metric(data_source_id, raw, name=raw.get("name") or metric_key, unit=unit)
        self.out.metrics.append(metric)
        unit = metric.unit
        window = raw.get("window") or {}
        end = format_date(window["currentEnd"]) if window.get("currentEnd") else None
        value_text = format_value(metric.value, unit)
        baseline_text = format_value(metric.baseline, unit)
        period = f"the {window_days} days ending {end}" if end else f"the last {window_days} days"
        p_value = raw.get("pValue")
        confidence = confidence_from_p_value(p_value)

        if metric.change_percent is None or metric.baseline is None:
            statement = (
                f"Over {period}, {label} came to {value_text}; "
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
                f"Over {period}, {label} came to {value_text}, {change} "
                f"from {baseline_text} in the previous {window_days} days{significance}."
            )

        evidence = self.add_evidence(
            source_type=EvidenceSourceType.METRIC,
            data_source_id=data_source_id,
            description=f"{capitalize(label)} KPI from table '{table}' (analytics-engine /kpis)",
            summary=statement,
            data={
                "kind": "kpi",
                "metricId": str(metric.id),
                "metricKey": metric_key,
                "metricName": label,
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
        )
        self.add_finding(
            analytics_type=AnalyticsType.DESCRIPTIVE,
            statement=statement,
            confidence=confidence,
            evidence=[evidence],
        )

    # -- anomalies -----------------------------------------------------------

    def anomaly(
        self,
        *,
        data_source_id: str,
        table: str,
        raw: dict[str, Any],
        series_metric: RunMetric,
        metric_key: str,
        label: str,
        unit: str | None,
        method_used: str,
        related_to: dict[str, str] | None = None,
        relation: str | None = None,
    ) -> tuple[RunEvidence, RunFinding]:
        """RunAnomaly + `anomaly` (or `co_anomaly` when `related_to` is set) evidence
        + DIAGNOSTIC finding. Confidence = erf(|z| / sqrt(2)) capped at 0.999.

        `related_to` = {metricKey, date} of the focus anomaly this one sits next to;
        `relation` is the clause appended to the statement ("on the same day as ...").
        """
        score = raw.get("deviationScore")
        direction = anomaly_direction(raw)
        severity = raw.get("severity") or "MEDIUM"
        when = parse_timestamp(raw["timestamp"])
        value_text = format_value(raw.get("value"), unit)
        expected_text = format_value(raw.get("expectedValue"), unit)
        detection = raw.get("detectionMethod") or method_used
        anomaly = RunAnomaly(
            id=uuid4(),
            metricId=series_metric.id,
            dataSourceId=data_source_id,
            description=raw.get("description")
            or f"{capitalize(label)} {direction} on {format_date(when)}",
            severity=severity,
            detectedAt=when,
            detectionMethod=detection,
            value=raw["value"],
            expectedValue=raw.get("expectedValue"),
            deviationScore=score,
        )
        self.out.anomalies.append(anomaly)

        verb = "dropped" if direction == "drop" else "spiked"
        score_text = f"deviation score {score:+.1f}, " if score is not None else ""
        statement = (
            f"{capitalize(label)} {verb} on {format_day(when)}: {value_text} against "
            f"an expected {expected_text} ({score_text}{severity} severity, "
            f"detected by {detection})"
            + (f", {relation}" if relation else "")
            + "."
        )
        confidence = confidence_from_deviation(score)
        data: dict[str, Any] = {
            "kind": "co_anomaly" if related_to else "anomaly",
            "anomalyId": str(anomaly.id),
            "metricId": str(series_metric.id),
            "metricKey": metric_key,
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
        }
        if related_to:
            data["relatedTo"] = related_to
        evidence = self.add_evidence(
            source_type=EvidenceSourceType.ANOMALY,
            data_source_id=data_source_id,
            description=f"Anomaly in daily {label} from table '{table}' "
            "(analytics-engine /anomalies/detect)",
            summary=anomaly.description,
            data=data,
            confidence=confidence,
        )
        finding = self.add_finding(
            analytics_type=AnalyticsType.DIAGNOSTIC,
            statement=statement,
            confidence=confidence,
            evidence=[evidence],
        )
        return evidence, finding


# ---------------------------------------------------------------------------
# /segments/compare helpers
# ---------------------------------------------------------------------------


def best_slice(response: dict[str, Any], *, allow_best_dimension: bool = False):
    """(slice dict incl. `column`, source) for the slice that explains the move.

    The engine's `topSlice` wins (source "engine"). With `allow_best_dimension`,
    when topSlice is null the largest-|delta| slice of the most concentrated
    dimension is used if that dimension's concentration >= 0.5 and the slice moved
    in the same direction as the total (source "best_dimension"). Else (None, None).
    """
    top = response.get("topSlice")
    if isinstance(top, dict) and top.get("value") is not None:
        return top, "engine"
    if not allow_best_dimension:
        return None, None
    dimensions = response.get("dimensions") or []
    total_delta = (response.get("total") or {}).get("delta") or 0.0
    if not dimensions or (dimensions[0].get("concentration") or 0.0) < 0.5:
        return None, None
    best = dimensions[0]
    for candidate in best.get("slices") or []:
        delta = candidate.get("delta") or 0.0
        if total_delta and delta * total_delta > 0:
            return {"column": best.get("column"), **candidate}, "best_dimension"
        break
    return None, None


def _formatted_slice(raw: dict[str, Any], unit: str | None) -> dict[str, str]:
    return {
        "actual": format_value(raw.get("actual"), unit),
        "expected": format_value(raw.get("expected"), unit),
        "delta": format_value(raw.get("delta"), unit),
        "deltaPercent": format_signed_percent(raw.get("deltaPercent")),
        **({"shareOfDelta": format_share(raw["shareOfDelta"])} if "shareOfDelta" in raw else {}),
    }


def segment_data(
    response: dict[str, Any],
    *,
    kind: str,
    metric_key: str,
    metric_name: str,
    unit: str | None,
    date: str,
    direction: str,
    top_slice: dict[str, Any] | None,
    top_slice_source: str | None = None,
) -> dict[str, Any]:
    """Evidence data for `segment` / `segment_volume` / `segment_neutral` (spec section 3)."""
    total = response.get("total") or {}
    dimensions = response.get("dimensions") or []
    concentration = dimensions[0].get("concentration") if dimensions else 0.0
    data: dict[str, Any] = {
        "kind": kind,
        "metricKey": metric_key,
        "metricName": metric_name,
        "unit": unit,
        "date": date,
        "direction": direction,
        "aggregation": response.get("aggregation"),
        "total": total,
        "topSlice": top_slice,
        "concentration": concentration,
        "dimensions": dimensions,
        "computationMethod": response.get("computationMethod") or "analytics-engine",
        "formatted": {
            "day": format_day(date),
            "total": _formatted_slice(total, unit),
            "concentration": format_share(concentration),
            "dimensions": [
                {
                    "column": dim.get("column"),
                    "concentration": format_share(dim.get("concentration")),
                    "slices": [
                        {"value": s.get("value"), **_formatted_slice(s, unit)}
                        for s in dim.get("slices") or []
                    ],
                }
                for dim in dimensions
            ],
        },
    }
    if top_slice is not None:
        data["formatted"]["topSlice"] = _formatted_slice(top_slice, unit)
    if top_slice_source is not None:
        data["topSliceSource"] = top_slice_source
    return data


def segment_statement(
    *, metric_label: str, date: str, direction: str, top: dict[str, Any], unit: str | None
) -> str:
    """'The revenue drop on Thursday 2026-10-08 is concentrated in channel = web: web
    revenue was $2,991.88 against an expected $17,515.16 (-82.9%), more than the whole
    day's shortfall on its own, while other channel values moved the other way.'

    A share above 100% means the slice moved more than the total did (the
    other slices partly offset it), so it is worded that way instead of as a
    percentage over 100."""
    move = "drop" if direction == "drop" else "spike"
    column, value = top.get("column"), top.get("value")
    share = top.get("shareOfDelta") or 0.0
    whole = "shortfall" if direction == "drop" else "increase"
    if share > 1:
        portion = (
            f"more than the whole day's {whole} on its own, while other {column} values "
            "moved the other way"
        )
    else:
        portion = f"{format_share(share)} of the total {whole}"
    return (
        f"The {metric_label} {move} on {format_day(date)} is concentrated in "
        f"{column} = {value}: {value} {metric_label} was {format_value(top.get('actual'), unit)} "
        f"against an expected {format_value(top.get('expected'), unit)} "
        f"({format_signed_percent(top.get('deltaPercent'))}), {portion}."
    )
