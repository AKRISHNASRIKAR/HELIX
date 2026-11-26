"""The Finance Agent (Phase 7): refunds, payment failures and revenue quality.

Depends on the Analytics step: AssembledContext.focus.anomalyDates names the
day(s) to explain (falls back to its own revenue anomaly detection). For an
orders-like table (picked with the Analytics planner's column heuristics) it:

1. Refunds: detects anomalies in the daily refund count and reports those
   within +-1 day of a focus date as `co_anomaly` evidence (or the top 2 as
   `anomaly` evidence when there is no focus at all) + DIAGNOSTIC findings.
   Confidence = erf(|z| / sqrt(2)), capped at 0.999 (as in Analytics).
2. Payment failure / volume: per focus date, /segments/compare on the order
   COUNT -> `segment_volume` evidence; a DIAGNOSTIC finding when the slice that
   explains the move fell by 50% or more.
   Confidence = concentration * min(1, |deltaPercent| / 100 + 0.5), clipped
   to [0, 1], where concentration is the best dimension's and deltaPercent the
   slice's (both from the engine).
3. Revenue quality: /correlation between daily non-refunded revenue and daily
   refunds -> `correlation` evidence (confidence 1 - pValue); a DESCRIPTIVE
   finding only when |coefficient| >= 0.5.

Every number in a statement comes from an engine response (ADR-005) and is
also stored in the evidence data. Result shape: see helix_agent_analytics.domain.
"""

from __future__ import annotations

from datetime import date as Date
from typing import Any

from helix_agent_analytics import AgentRun, DomainAgent, Focus, NoUsableDatasetError
from helix_agent_analytics.engine_client import AnalyticsEngineError
from helix_agent_analytics.formatting import (
    capitalize,
    confidence_from_p_value,
    format_day,
    format_signed_percent,
    format_value,
)
from helix_agent_analytics.planner import (
    AnalysisPlan,
    find_table,
    non_refund_filter,
    pick_segment_dimensions,
    plan_for_metric,
)
from helix_agent_analytics.records import best_slice, rank_anomalies, segment_data
from helix_contracts import (
    AgentCapability,
    AgentType,
    AnalyticsType,
    ContextRequirements,
    EvidenceSourceType,
)

from . import __version__

CAPABILITIES = [
    AgentCapability(
        name="refund_analysis",
        description="Finds refund spikes next to the anomaly being investigated.",
    ),
    AgentCapability(
        name="payment_failure_analysis",
        description="Checks whether order volume collapsed in one channel (a checkout or "
        "payment failure) rather than across the board (lower demand).",
    ),
    AgentCapability(
        name="revenue_quality",
        description="Correlates daily revenue with daily refunds.",
    ),
]

#: Other slices moving less than this (percent) count as "within their normal range".
NORMAL_RANGE_PERCENT = 20.0
#: A slice must fall at least this much (percent) to be called a collapse.
COLLAPSE_PERCENT = -50.0
#: |coefficient| needed for a correlation finding.
MIN_CORRELATION = 0.5


def volume_confidence(concentration: float | None, delta_percent: float | None) -> float:
    """concentration * min(1, |deltaPercent| / 100 + 0.5), clipped to [0, 1]."""
    conc = max(0.0, min(1.0, concentration or 0.0))
    magnitude = min(1.0, abs(delta_percent or 0.0) / 100 + 0.5)
    return round(max(0.0, min(1.0, conc * magnitude)), 4)


def _plural(column: str) -> str:
    return f"{column} values" if column.endswith(("s", "y", "x")) else f"{column}s"


def _days_apart(a: str, b: str) -> int:
    return (Date.fromisoformat(a[:10]) - Date.fromisoformat(b[:10])).days


class FinanceAgent(DomainAgent):
    agent_type = AgentType.FINANCE
    name = "Finance Agent"
    description = (
        "Explains revenue anomalies through refunds, payment/checkout failures and "
        "revenue quality, using analytics-engine tool calls."
    )
    version = __version__
    context_requirements = ContextRequirements(
        semanticTypes=["datetime", "currency", "categorical"],
        tableKeywords=["order", "payment", "refund", "transaction", "invoice", "charge"],
    )

    @property
    def capabilities(self) -> list[AgentCapability]:
        return list(CAPABILITIES)

    async def run(self, run: AgentRun) -> None:
        sources = run.ctx.data_sources
        if not sources:
            raise NoUsableDatasetError(
                "No connected data sources were provided, so there is nothing to analyze."
            )
        orders = plan_for_metric("orders", sources)
        refunds = plan_for_metric("refunds", sources)
        revenue = plan_for_metric("revenue", sources)
        if orders is None:
            raise NoUsableDatasetError(
                "No connected table has a datetime column, so order volume and refunds "
                "cannot be analyzed."
            )
        run.plan.update(
            table=orders.dataset.table,
            dataSourceId=orders.dataset.data_source_id,
            timeColumn=orders.dataset.time_column,
            refundFilter=refunds.dataset.filter if refunds else None,
            revenueColumn=revenue.dataset.value_column if revenue else None,
        )
        focus = await self.resolve_focus(run)

        if refunds is not None:
            await self._refunds(run, focus, refunds)
        else:
            run.reasoning.append("No status or refund column, so refunds were not analyzed.")
        for day in focus.dates:
            await self._volume(run, focus, orders, day)
        if refunds is not None and revenue is not None:
            await self._correlation(run, revenue, refunds)
        elif revenue is None:
            run.reasoning.append("No currency column, so revenue quality was not analyzed.")

    # ------------------------------------------------------------------
    # 1. Refunds
    # ------------------------------------------------------------------

    async def _refunds(self, run: AgentRun, focus: Focus, plan: AnalysisPlan) -> None:
        label = plan.intent.label
        response = await self.engine.detect_anomalies(
            {
                "dataset": run.dataset(plan.dataset),
                **plan.series_spec,
                "method": "auto",
                "metricName": label,
            },
            run.log,
        )
        raw_metric = response.get("metric")
        if not raw_metric:
            run.out.warnings.append("Refund anomaly detection returned no metric series.")
            return
        series = run.rec.metric(
            plan.dataset.data_source_id, raw_metric, name=f"{label} (daily)", unit=None
        )
        run.out.metrics.append(series)
        detected = response.get("anomalies") or []
        run.out.anomaly_count += len(detected)
        method_used = response.get("methodUsed") or "auto"

        picks: list[tuple[dict[str, Any], str | None]] = []
        if focus.dates:
            for raw in sorted(detected, key=lambda a: str(a.get("timestamp"))):
                day = str(raw.get("timestamp"))[:10]
                near = [f for f in focus.dates if abs(_days_apart(day, f)) <= 1]
                if near:
                    picks.append((raw, min(near, key=lambda f: abs(_days_apart(day, f)))))
            if not picks:
                run.reasoning.append(
                    f"None of the {len(detected)} refund anomalies is within one day of "
                    f"{', '.join(focus.dates)}."
                )
        else:
            picks = [(raw, None) for raw in rank_anomalies(detected, "spike", 2)]

        for raw, related in picks:
            relation = None
            related_to = None
            if related is not None:
                offset = _days_apart(str(raw["timestamp"]), related)
                what = f"the {focus.metric_label} {focus.move}"
                relation = (
                    f"on the same day as {what}" if offset == 0
                    else f"one day {'after' if offset > 0 else 'before'} {what} on {related}"
                )
                related_to = {"metricKey": focus.metric_key, "date": related}
            run.rec.anomaly(
                data_source_id=plan.dataset.data_source_id,
                table=plan.dataset.table,
                raw=raw,
                series_metric=series,
                metric_key=plan.intent.key,
                label=label,
                unit=None,
                method_used=method_used,
                related_to=related_to,
                relation=relation,
            )

    # ------------------------------------------------------------------
    # 2. Payment failure / order volume by slice
    # ------------------------------------------------------------------

    async def _volume(self, run: AgentRun, focus: Focus, plan: AnalysisPlan, day: str) -> None:
        table = find_table(run.ctx.data_sources, plan.dataset.data_source_id, plan.dataset.table)
        dimensions = (
            pick_segment_dimensions(table, exclude=[plan.dataset.time_column]) if table else []
        )
        if not dimensions:
            run.reasoning.append(
                f"Table '{plan.dataset.table}' has no categorical columns, so order volume "
                f"on {day} was not broken down."
            )
            return
        response = await self.engine.compare_segments(
            {
                "dataset": run.dataset(plan.dataset),
                "timeColumn": plan.dataset.time_column,
                "aggregation": "count",
                "dimensions": dimensions,
                "targetDate": day,
                "baseline": "same_weekday",
                "baselinePeriods": 4,
                "metricName": "orders",
            },
            run.log,
        )
        top, source = best_slice(response, allow_best_dimension=True)
        total_delta = (response.get("total") or {}).get("delta") or 0.0
        direction = "drop" if total_delta < 0 else "spike"
        data = segment_data(
            response, kind="segment_volume", metric_key="orders", metric_name="orders",
            unit=None, date=day, direction=direction, top_slice=top, top_slice_source=source,
        )
        data["relatedTo"] = {"metricKey": focus.metric_key, "date": day}
        confidence = volume_confidence(
            data["concentration"], top.get("deltaPercent") if top else 0.0
        )

        statement = None
        delta_percent = top.get("deltaPercent") if top else None
        if top is not None and delta_percent is not None and delta_percent <= COLLAPSE_PERCENT:
            column, value = str(top.get("column")), str(top.get("value"))
            others = [
                s for dim in response.get("dimensions") or [] if dim.get("column") == column
                for s in dim.get("slices") or [] if s.get("value") != top.get("value")
            ]
            normal = all(
                abs(s.get("deltaPercent") or 0.0) <= NORMAL_RANGE_PERCENT for s in others
            )
            if normal:
                tail = (
                    f"while other {_plural(column)} were within their normal range, which "
                    f"points to a checkout or payment failure in the {value} {column} rather "
                    "than lower demand"
                )
            else:
                worst = max(abs(s.get("deltaPercent") or 0.0) for s in others)
                data["formatted"]["otherSlicesMaxMove"] = f"{worst:.1f}%"
                tail = (
                    f"while other {_plural(column)} moved by up to {worst:.1f}%, which points "
                    f"to a problem concentrated in the {value} {column}"
                )
            statement = (
                f"{capitalize(value)} orders fell to {format_value(top.get('actual'), None)} on "
                f"{format_day(day)} against an expected {format_value(top.get('expected'), None)} "
                f"({format_signed_percent(delta_percent)}), {tail}."
            )
        elif top is None:
            run.reasoning.append(f"Order volume on {day} is not concentrated in one slice.")
        else:
            run.reasoning.append(
                f"Order volume in {top.get('column')} = {top.get('value')} on {day} did not "
                "collapse, so no payment failure is claimed."
            )

        evidence = run.rec.add_evidence(
            source_type=EvidenceSourceType.METRIC,
            data_source_id=plan.dataset.data_source_id,
            description=f"Order count by slice on {day} from table '{plan.dataset.table}' "
            "(analytics-engine /segments/compare)",
            summary=statement or f"Order count by {', '.join(dimensions)} on {day}.",
            data=data,
            confidence=confidence,
        )
        if statement is not None:
            run.rec.add_finding(
                analytics_type=AnalyticsType.DIAGNOSTIC,
                statement=statement,
                confidence=confidence,
                evidence=[evidence],
            )

    # ------------------------------------------------------------------
    # 3. Revenue quality: revenue vs refunds correlation
    # ------------------------------------------------------------------

    async def _correlation(
        self, run: AgentRun, revenue: AnalysisPlan, refunds: AnalysisPlan
    ) -> None:
        table = find_table(
            run.ctx.data_sources, revenue.dataset.data_source_id, revenue.dataset.table
        )
        a: dict[str, Any] = {
            "dataset": run.dataset(revenue.dataset),
            "timeColumn": revenue.dataset.time_column,
            "valueColumn": revenue.dataset.value_column,
            "aggregation": "sum",
        }
        keep = non_refund_filter(table) if table else None
        if keep:
            a["filter"] = keep
        b = {"dataset": run.dataset(refunds.dataset), **refunds.series_spec}
        try:
            response = await self.engine.correlate(
                {"a": a, "b": b, "method": "spearman", "maxLag": 3}, run.log
            )
        except AnalyticsEngineError as exc:
            # Correlation is supporting context; refunds and volume still stand.
            run.out.warnings.append(f"Revenue/refund correlation skipped: {exc}")
            return
        coefficient = response.get("coefficient")
        if coefficient is None:
            run.out.warnings.append("Correlation returned no coefficient.")
            return
        method = str(response.get("method") or "spearman")
        lag = response.get("lag") or 0
        p_value = response.get("pValue")
        n = response.get("n")
        revenue_label = "revenue (excluding refunds)" if keep else "revenue"
        formatted = {
            "coefficient": f"{coefficient:+.2f}",
            "pValue": f"{p_value:.3g}" if p_value is not None else "n/a",
            "lag": str(lag),
            "n": str(n),
        }
        strength = "strongly" if abs(coefficient) >= 0.7 else "moderately"
        sign = "positively" if coefficient > 0 else "negatively"
        lag_text = f", refunds shifted by {lag} day(s)" if lag else ""
        p_text = f", p = {formatted['pValue']}" if p_value is not None else ""
        statement = (
            f"Daily {revenue_label} and daily refunds are {strength} {sign} correlated "
            f"({capitalize(method)} {formatted['coefficient']}{p_text}, n = {n} days{lag_text})."
        )
        confidence = confidence_from_p_value(p_value)
        evidence = run.rec.add_evidence(
            source_type=EvidenceSourceType.METRIC,
            data_source_id=revenue.dataset.data_source_id,
            description=f"Correlation of daily {revenue_label} and daily refunds from table "
            f"'{revenue.dataset.table}' (analytics-engine /correlation)",
            summary=statement if abs(coefficient) >= MIN_CORRELATION else (
                f"Daily {revenue_label} vs refunds: {capitalize(method)} "
                f"{formatted['coefficient']} (below {MIN_CORRELATION})."
            ),
            data={
                "kind": "correlation",
                "metricKey": "revenue",
                "otherMetricKey": "refunds",
                "metricName": revenue_label,
                "unit": "USD",
                "coefficient": coefficient,
                "method": method,
                "lag": lag,
                "pValue": p_value,
                "n": n,
                "computationMethod": response.get("computationMethod") or "analytics-engine",
                "formatted": formatted,
            },
            confidence=confidence,
        )
        if abs(coefficient) >= MIN_CORRELATION:
            run.rec.add_finding(
                analytics_type=AnalyticsType.DESCRIPTIVE,
                statement=statement,
                confidence=confidence,
                evidence=[evidence],
            )
        else:
            run.reasoning.append(
                f"Revenue/refund correlation {formatted['coefficient']} is below "
                f"{MIN_CORRELATION}, so it is not reported as a finding."
            )
