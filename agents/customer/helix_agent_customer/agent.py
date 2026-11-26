"""The Customer Agent (Phase 7): customer activity and segment mix.

Depends on the Analytics step: AssembledContext.focus.anomalyDates names the
day(s) to explain (falls back to its own anomaly detection on the focus
metric). Work:

1. Customer activity: daily active customers (count_distinct of the customer
   id column) as a `kpi` evidence + DESCRIPTIVE finding (confidence
   1 - pValue), and active-customer anomalies within +-1 day of a focus date as
   `co_anomaly` evidence (or the top 2 as `anomaly` when there is no focus) +
   DIAGNOSTIC findings (confidence erf(|z| / sqrt(2)), capped at 0.999).
2. Segment mix: per focus date, /segments/compare on the focus metric (from
   focus.metricKeys, default revenue) restricted to customer-attribute columns
   (names containing segment|tier|plan|cohort|region|country, never channel).
   - concentration < 0.5: `segment_neutral` evidence + DIAGNOSTIC finding that
     customer segments are not the driver. Confidence = 1 - concentration.
   - concentration >= 0.5 with an engine topSlice: `segment` evidence + finding.
     Confidence = concentration * the upstream anomaly evidence confidence for
     that date (concentration alone when no upstream anomaly is in context).

Every number in a statement comes from an engine response (ADR-005).
"""

from __future__ import annotations

from datetime import date as Date

from helix_agent_analytics import AgentRun, DomainAgent, Focus, NoUsableDatasetError
from helix_agent_analytics.formatting import format_signed_percent, join_words
from helix_agent_analytics.planner import (
    AnalysisPlan,
    find_table,
    pick_segment_dimensions,
    plan_for_metric,
)
from helix_agent_analytics.records import (
    best_slice,
    rank_anomalies,
    segment_data,
    segment_statement,
)
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
        name="customer_activity",
        description="Daily active customers: KPI change and anomalies next to the focus day.",
    ),
    AgentCapability(
        name="segment_mix",
        description="Checks whether a customer segment (tier, plan, cohort, region) explains "
        "the anomaly or whether every segment moved alike.",
    ),
]

#: Column names that describe the customer (not the purchase channel).
CUSTOMER_DIMENSION_PATTERN = r"segment|tier|plan|cohort|region|country"
NON_CUSTOMER_DIMENSION_PATTERN = r"channel"
#: Below this concentration no customer dimension explains the move.
NEUTRAL_BELOW = 0.5


def _days_apart(a: str, b: str) -> int:
    return (Date.fromisoformat(a[:10]) - Date.fromisoformat(b[:10])).days


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


class CustomerAgent(DomainAgent):
    agent_type = AgentType.CUSTOMER
    name = "Customer Agent"
    description = (
        "Explains anomalies through customer activity and segment mix, using "
        "analytics-engine tool calls."
    )
    version = __version__
    context_requirements = ContextRequirements(
        semanticTypes=["datetime", "identifier", "categorical"],
        tableKeywords=["customer", "user", "order", "account"],
    )
    kpi_window_days = 7

    @property
    def capabilities(self) -> list[AgentCapability]:
        return list(CAPABILITIES)

    async def run(self, run: AgentRun) -> None:
        sources = run.ctx.data_sources
        if not sources:
            raise NoUsableDatasetError(
                "No connected data sources were provided, so there is nothing to analyze."
            )
        customers = plan_for_metric("customers", sources)
        focus = await self.resolve_focus(run)
        metric_plan = plan_for_metric(focus.metric_key, sources)
        if customers is None and metric_plan is None:
            raise NoUsableDatasetError(
                "No connected table has a datetime column with a customer id or the "
                f"{focus.metric_label} metric, so customer activity cannot be analyzed."
            )
        run.plan.update(
            customerTable=customers.dataset.table if customers else None,
            customerColumn=customers.dataset.value_column if customers else None,
            segmentTable=metric_plan.dataset.table if metric_plan else None,
        )
        if customers is not None:
            await self._activity(run, focus, customers)
        else:
            run.reasoning.append("No customer id column, so customer activity was skipped.")
        if metric_plan is not None:
            for day in focus.dates:
                await self._segment_mix(run, focus, metric_plan, day)

    # ------------------------------------------------------------------
    # 1. Customer activity
    # ------------------------------------------------------------------

    async def _activity(self, run: AgentRun, focus: Focus, plan: AnalysisPlan) -> None:
        dataset = run.dataset(plan.dataset)
        intent = plan.intent
        kpi_response = await self.engine.kpis(
            {
                "dataset": dataset,
                "timeColumn": plan.dataset.time_column,
                "kpis": [plan.kpi_spec],
                "windowDays": self.kpi_window_days,
            },
            run.log,
        )
        for raw in kpi_response.get("metrics") or []:
            run.rec.kpi(
                data_source_id=plan.dataset.data_source_id,
                table=plan.dataset.table,
                raw=raw,
                metric_key=intent.key,
                label=intent.label,
                unit=None,
                window_days=self.kpi_window_days,
            )

        response = await self.engine.detect_anomalies(
            {"dataset": dataset, **plan.series_spec, "method": "auto", "metricName": intent.label},
            run.log,
        )
        raw_metric = response.get("metric")
        if not raw_metric:
            run.out.warnings.append("Active-customer anomaly detection returned no series.")
            return
        series = run.rec.metric(
            plan.dataset.data_source_id, raw_metric, name=f"{intent.label} (daily)", unit=None
        )
        run.out.metrics.append(series)
        detected = response.get("anomalies") or []
        run.out.anomaly_count += len(detected)
        method_used = response.get("methodUsed") or "auto"

        picks: list[tuple[dict, str | None]] = []
        if focus.dates:
            for raw in sorted(detected, key=lambda a: str(a.get("timestamp"))):
                day = str(raw.get("timestamp"))[:10]
                near = [f for f in focus.dates if abs(_days_apart(day, f)) <= 1]
                if near:
                    picks.append((raw, min(near, key=lambda f: abs(_days_apart(day, f)))))
        else:
            picks = [(raw, None) for raw in rank_anomalies(detected, focus.direction, 2)]
        for raw, related in picks:
            relation = related_to = None
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
                metric_key=intent.key,
                label=intent.label,
                unit=None,
                method_used=method_used,
                related_to=related_to,
                relation=relation,
            )

    # ------------------------------------------------------------------
    # 2. Segment mix
    # ------------------------------------------------------------------

    def _upstream_anomaly_confidence(self, run: AgentRun, metric_key: str, day: str):
        for item in run.ctx.upstream_evidence:
            data = item.get("data") or {}
            if (
                data.get("kind") == "anomaly"
                and data.get("metricKey") == metric_key
                and str(data.get("date") or "")[:10] == day
                and isinstance(item.get("confidence"), int | float)
            ):
                return float(item["confidence"])
        return None

    async def _segment_mix(
        self, run: AgentRun, focus: Focus, plan: AnalysisPlan, day: str
    ) -> None:
        table = find_table(run.ctx.data_sources, plan.dataset.data_source_id, plan.dataset.table)
        exclude = [plan.dataset.time_column, plan.dataset.value_column or ""]
        dimensions = (
            pick_segment_dimensions(
                table,
                exclude=exclude,
                name_pattern=CUSTOMER_DIMENSION_PATTERN,
                exclude_pattern=NON_CUSTOMER_DIMENSION_PATTERN,
            )
            if table else []
        )
        if not dimensions:
            run.reasoning.append(
                f"Table '{plan.dataset.table}' has no customer attribute columns "
                "(segment, tier, plan, cohort, region, country), so segment mix was skipped."
            )
            return
        intent = plan.intent
        label = intent.series_label or intent.label
        unit = intent.series_unit if intent.series_label else intent.unit
        body = {
            "dataset": run.dataset(plan.dataset),
            **plan.series_spec,
            "dimensions": dimensions,
            "targetDate": day,
            "baseline": "same_weekday",
            "baselinePeriods": 4,
            "metricName": label,
        }
        if unit:
            body["unit"] = unit
        response = await self.engine.compare_segments(body, run.log)
        total = response.get("total") or {}
        direction = focus.direction or ("drop" if (total.get("delta") or 0) < 0 else "spike")
        move = direction if direction in ("drop", "spike") else "change"
        dims = response.get("dimensions") or []
        concentration = (dims[0].get("concentration") or 0.0) if dims else 0.0
        source_description = (
            f"Customer segment breakdown of daily {label} on {day} from table "
            f"'{plan.dataset.table}' (analytics-engine /segments/compare)"
        )

        if concentration < NEUTRAL_BELOW:
            data = segment_data(
                response, kind="segment_neutral", metric_key=intent.key, metric_name=label,
                unit=unit, date=day, direction=direction, top_slice=None,
            )
            total_pct = total.get("deltaPercent")
            gaps = [
                abs(s["deltaPercent"] - total_pct)
                for dim in dims for s in dim.get("slices") or []
                if s.get("deltaPercent") is not None and total_pct is not None
            ]
            gap = max(gaps, default=0.0)
            data["maxGapPoints"] = round(gap, 2)
            data["formatted"]["maxGapPoints"] = f"{gap:.1f}"
            if len(dims) == 1:
                values = sorted(str(s.get("value")) for s in dims[0].get("slices") or [])
                spread = f"{join_words(values)} all moved"
            else:
                spread = f"every {join_words([str(d.get('column')) for d in dims])} slice moved"
            statement = (
                f"Customer segments do not explain the {label} {move} on {day}: {spread} "
                f"within {gap:.1f} percentage points of the overall change "
                f"({format_signed_percent(total_pct)})."
            )
            confidence = _clamp(1.0 - concentration)
            evidence = run.rec.add_evidence(
                source_type=EvidenceSourceType.METRIC,
                data_source_id=plan.dataset.data_source_id,
                description=source_description,
                summary=statement,
                data=data,
                confidence=confidence,
            )
            run.rec.add_finding(
                analytics_type=AnalyticsType.DIAGNOSTIC,
                statement=statement,
                confidence=confidence,
                evidence=[evidence],
            )
            return

        top, source = best_slice(response)
        if top is None:
            run.reasoning.append(
                f"Customer segments are concentrated ({concentration:.2f}) on {day} but no "
                "single slice stands out, so no segment claim is made."
            )
            return
        data = segment_data(
            response, kind="segment", metric_key=intent.key, metric_name=label, unit=unit,
            date=day, direction=direction, top_slice=top, top_slice_source=source,
        )
        statement = segment_statement(
            metric_label=label, date=day, direction=direction, top=top, unit=unit
        )
        anomaly_confidence = self._upstream_anomaly_confidence(run, intent.key, day)
        confidence = _clamp(concentration * (anomaly_confidence or 1.0))
        evidence = run.rec.add_evidence(
            source_type=EvidenceSourceType.METRIC,
            data_source_id=plan.dataset.data_source_id,
            description=source_description,
            summary=statement,
            data=data,
            confidence=confidence,
        )
        run.rec.add_finding(
            analytics_type=AnalyticsType.DIAGNOSTIC,
            statement=statement,
            confidence=confidence,
            evidence=[evidence],
        )
