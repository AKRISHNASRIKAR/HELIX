"""The Product Agent (Phase 7): which deploy, release or commit lines up with the anomaly.

Depends on the Analytics step: AssembledContext.focus.anomalyDates names the
day(s) to explain (falls back to its own anomaly detection on any tabular
source in the context). Work:

1. Find an events table: a table whose name contains deploy|release|commit and
   that has a datetime column (MCP / GITHUB sources first). None -> the task
   still SUCCEEDS with zero findings and plan.reasoning says why.
2. /events/align with the focus days as targets (24h before / 24h after) and
   every non-time column as a label.
3. Per target day, events from before the day or on the day (events after
   the day cannot have caused it) become `event_alignment` evidence
   (sourceType API_RESPONSE) + a DIAGNOSTIC finding, best 3 per day.

keywordMatch = event label words that also appear in the upstream segment
topSlice values (e.g. "web") or the focus metric's vocabulary (revenue ->
checkout, payment, cart, ...).

Confidence = proximity * relevance, where
    proximity = 1.0 for a same-day event, else exp(-max(0, hoursBefore) / 24)
    relevance = 1.0 when keywordMatch is non-empty, else 0.4,
                times 0.3 when the event looks like a revert or hotfix (its
                description/version says revert, rollback, hotfix, ...), since
                a fix is a response to the problem rather than its cause
and hoursBefore = (start of the anomaly day - event time) in hours, as
returned by the engine.
"""

from __future__ import annotations

import math
import re
from typing import Any

from helix_agent_analytics import AgentRun, DomainAgent, Focus
from helix_agent_analytics.formatting import format_day, join_words, parse_timestamp
from helix_agent_analytics.planner import INTENTS, pick_time_column
from helix_contracts import (
    AgentCapability,
    AgentType,
    AnalyticsType,
    ContextRequirements,
    DataSourceContext,
    DataSourceType,
    EvidenceSourceType,
    TableSchema,
)

from . import __version__

CAPABILITIES = [
    AgentCapability(
        name="deployment_correlation",
        description="Lines up deployments, releases and commits with the anomaly day.",
    ),
    AgentCapability(
        name="release_impact",
        description="Ranks the changes most likely to have caused the anomaly (timing and "
        "affected area).",
    ),
]

EVENTS_TABLE_PATTERN = re.compile(r"deploy|release|commit", re.IGNORECASE)
WINDOW_HOURS_BEFORE = 24.0
WINDOW_HOURS_AFTER = 24.0
MAX_EVENTS_PER_DAY = 3
RELEVANCE_MATCH = 1.0
RELEVANCE_NO_MATCH = 0.4

_COMMERCE = ("checkout", "payment", "payments", "pay", "cart", "billing", "order", "orders",
             "pricing", "price")
#: Words that tie a change to a metric's area.
METRIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "revenue": _COMMERCE,
    "orders": _COMMERCE,
    "aov": _COMMERCE,
    "refunds": ("refund", "refunds", "payment", "payments", "checkout", "billing"),
    "refund_amount": ("refund", "refunds", "payment", "payments", "checkout", "billing"),
    "refund_rate": ("refund", "refunds", "payment", "payments", "checkout", "billing"),
    "customers": ("signup", "login", "auth", "account", "onboarding"),
}

_ROLLED_BACK = {"rolled_back", "rollback", "reverted", "rolledback"}
_FAILED = {"failed", "failure", "error", "errored"}
_REVERT_RE = re.compile(r"\b(revert\w*|roll(ed)?[\s-]?back|hotfix|undo)\b", re.IGNORECASE)
REVERT_FACTOR = 0.3


def looks_like_revert(labels: dict[str, Any]) -> bool:
    """True when an event's description or version reads like a revert or hotfix."""
    keys = ("description", "version", "title", "message")
    text = " ".join(str(labels.get(k) or "") for k in keys)
    return bool(_REVERT_RE.search(text))


def event_relevance(keyword_match: list[str], revert: bool = False) -> float:
    relevance = RELEVANCE_MATCH if keyword_match else RELEVANCE_NO_MATCH
    return round(relevance * (REVERT_FACTOR if revert else 1.0), 4)


def event_confidence(
    hours_before: float, same_day: bool, keyword_match: list[str], revert: bool = False
) -> float:
    """proximity * relevance (see module docstring)."""
    proximity = 1.0 if same_day else math.exp(-max(0.0, hours_before) / 24.0)
    relevance = event_relevance(keyword_match, revert)
    return round(max(0.0, min(1.0, proximity * relevance)), 4)


def _words(value: Any) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", str(value).lower()))


def _noun(table_name: str) -> str:
    lowered = table_name.lower()
    if "release" in lowered:
        return "Release"
    if "commit" in lowered:
        return "Commit"
    return "Deployment"


def find_events_table(
    data_sources: list[DataSourceContext],
) -> tuple[DataSourceContext, TableSchema, str] | None:
    """(source, table, time column) of the first events table, MCP/GITHUB sources first."""
    preferred = (DataSourceType.MCP, DataSourceType.GITHUB)
    ordered = sorted(data_sources, key=lambda s: s.type not in preferred)
    for source in ordered:
        for table in source.schemas:
            if not EVENTS_TABLE_PATTERN.search(table.table_name):
                continue
            time_col = pick_time_column(table)
            if time_col is not None:
                return source, table, time_col.name
    return None


class ProductAgent(DomainAgent):
    agent_type = AgentType.PRODUCT
    name = "Product Agent"
    description = (
        "Explains anomalies through engineering changes: lines up deployments, releases and "
        "commits with the anomaly day using analytics-engine /events/align."
    )
    version = __version__
    context_requirements = ContextRequirements(
        dataSourceTypes=[DataSourceType.MCP, DataSourceType.GITHUB],
        tableKeywords=["deploy", "release", "commit", "change"],
        semanticTypes=["datetime"],
    )

    @property
    def capabilities(self) -> list[AgentCapability]:
        return list(CAPABILITIES)

    async def run(self, run: AgentRun) -> None:
        found = find_events_table(run.ctx.data_sources)
        if found is None:
            run.reasoning.append(
                "No deployment, release or commit table with a datetime column is connected "
                "(connect an MCP or GitHub source), so there are no changes to line up with "
                "the anomaly."
            )
            run.plan.update(eventsTable=None)
            return
        source, table, time_column = found
        run.plan.update(
            eventsTable=table.table_name, eventsDataSourceId=str(source.id), timeColumn=time_column
        )
        run.reasoning.append(
            f"Using events table '{table.table_name}' from data source '{source.name}' "
            f"(time column '{time_column}')."
        )

        # Own detection (fallback) only looks at the non-event tables.
        tabular = [
            s.model_copy(update={"schemas": [
                t for t in s.schemas if not EVENTS_TABLE_PATTERN.search(t.table_name)
            ]})
            for s in run.ctx.data_sources
        ]
        focus = await self.resolve_focus(run, [s for s in tabular if s.schemas])
        if not focus.dates:
            return

        label_columns = [c.name for c in table.columns if c.name != time_column]
        response = await self.engine.align_events(
            {
                "events": {
                    "dataset": {
                        "dataSourceId": str(source.id),
                        "organizationId": run.ctx.organization_id,
                        "table": table.table_name,
                    },
                    "timeColumn": time_column,
                    "labelColumns": label_columns,
                },
                "targets": [
                    {"date": day, "label": f"{focus.metric_label} {focus.move}"}
                    for day in focus.dates
                ],
                "windowHoursBefore": WINDOW_HOURS_BEFORE,
                "windowHoursAfter": WINDOW_HOURS_AFTER,
            },
            run.log,
        )
        for match in response.get("matches") or []:
            self._add_match(run, focus, source, table, match, response)

    def _keywords(self, run: AgentRun, focus: Focus, day: str) -> set[str]:
        keywords = set(METRIC_KEYWORDS.get(focus.metric_key, ()))
        slices = run.ctx.upstream_top_slices(day) or run.ctx.upstream_top_slices()
        for top in slices:
            keywords |= _words(top.get("value"))
        return keywords

    def _add_match(
        self,
        run: AgentRun,
        focus: Focus,
        source: DataSourceContext,
        table: TableSchema,
        match: dict[str, Any],
        response: dict[str, Any],
    ) -> None:
        day = str((match.get("target") or {}).get("date") or "")[:10]
        events = match.get("events") or []
        keywords = self._keywords(run, focus, day)
        scored = []
        later = 0
        for event in events:
            hours_before = float(event.get("hoursBefore") or 0.0)
            same_day = bool(event.get("sameDay"))
            if not same_day and hours_before < 0:
                later += 1  # after the anomaly day: cannot be its cause
                continue
            labels = event.get("labels") or {}
            label_words: set[str] = set()
            for value in labels.values():
                label_words |= _words(value)
            keyword_match = sorted(label_words & keywords)
            confidence = event_confidence(
                hours_before, same_day, keyword_match, looks_like_revert(labels)
            )
            scored.append((confidence, event, keyword_match))
        scored.sort(key=lambda item: (-item[0], abs(float(item[1].get("hoursBefore") or 0.0))))
        if later:
            run.reasoning.append(f"{later} event(s) after {day} were ignored as possible causes.")
        if not scored:
            noun = _noun(table.table_name).lower()
            run.reasoning.append(f"No {noun}s in the window around {day}.")
            return
        for confidence, event, keyword_match in scored[:MAX_EVENTS_PER_DAY]:
            self._record(run, focus, source, table, day, event, keyword_match, confidence,
                         response)

    def _record(
        self,
        run: AgentRun,
        focus: Focus,
        source: DataSourceContext,
        table: TableSchema,
        day: str,
        event: dict[str, Any],
        keyword_match: list[str],
        confidence: float,
        response: dict[str, Any],
    ) -> None:
        labels = {k: v for k, v in (event.get("labels") or {}).items()}
        hours_before = float(event.get("hoursBefore") or 0.0)
        same_day = bool(event.get("sameDay"))
        when = parse_timestamp(event["time"])
        clock = when.strftime("%H:%M")
        hours = abs(hours_before)
        hours_text = f"{hours:.1f}"

        name = labels.get("service") or labels.get("name") or labels.get("repo") or (
            str(labels.get("sha") or labels.get("id") or "")[:12]
        )
        version = labels.get("version") or labels.get("ref") or labels.get("tag")
        environment = labels.get("environment")
        subject = " ".join(
            part for part in (_noun(table.table_name), str(name or ""), str(version or ""))
            if part
        )
        if environment:
            subject += f" to {environment}"
        anomaly_day = f"the {focus.metric_label} {focus.move} day"
        if same_day:
            timing = (
                f"landed at the start of {anomaly_day} (same day)" if hours == 0
                else f"landed {hours_text} hours into {anomaly_day} (same day)"
            )
        else:
            timing = f"came {hours_text} hours before the start of {anomaly_day}"
        status = str(labels.get("status") or "").lower()
        status_text = (
            "; it was later rolled back" if status in _ROLLED_BACK
            else "; it failed" if status in _FAILED else ""
        )
        revert = looks_like_revert(labels)
        if revert:
            status_text += (
                "; it reads as a revert or fix, so it is more likely a response than a cause"
            )
        statement = f"{subject} at {clock} UTC on {format_day(when)} {timing}{status_text}."
        if keyword_match:
            statement += (
                f" Its labels mention {join_words(keyword_match)}, matching the affected "
                "metric or segment."
            )

        proximity = 1.0 if same_day else round(math.exp(-max(0.0, hours_before) / 24.0), 4)
        relevance = event_relevance(keyword_match, revert)
        unit = INTENTS[focus.metric_key].unit if focus.metric_key in INTENTS else None
        evidence = run.rec.add_evidence(
            source_type=EvidenceSourceType.API_RESPONSE,
            data_source_id=str(source.id),
            description=f"{_noun(table.table_name)} from table '{table.table_name}' near {day} "
            "(analytics-engine /events/align)",
            summary=statement,
            data={
                "kind": "event_alignment",
                "metricKey": focus.metric_key,
                "metricName": focus.metric_label,
                "unit": unit,
                "date": day,
                "event": {"time": event["time"], "labels": labels},
                "hoursBefore": hours_before,
                "sameDay": same_day,
                "keywordMatch": keyword_match,
                "revert": revert,
                "proximity": proximity,
                "relevance": relevance,
                "eventsTable": table.table_name,
                "computationMethod": response.get("computationMethod") or "analytics-engine",
                "formatted": {
                    "time": f"{clock} UTC",
                    "day": format_day(when),
                    "hours": hours_text,
                    "status": status or None,
                },
            },
            confidence=confidence,
        )
        run.rec.add_finding(
            analytics_type=AnalyticsType.DIAGNOSTIC,
            statement=statement,
            confidence=confidence,
            evidence=[evidence],
        )
