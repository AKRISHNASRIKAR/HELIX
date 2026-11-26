"""The context assembly pipeline behind POST /context/assemble (build spec 6.1).

Given one AgentTask's ContextAssembleRequest, decide what that agent sees:

1. data sources: filter by type, then by column semanticType, then rank (and
   filter) tables by keyword hits, never dropping everything on keywords alone;
2. focus: the anomaly days, metric keys and direction the task should explain,
   from the trigger and the upstream evidence;
3. history: recent metrics/anomalies/findings of the organization (best effort);
4. upstream: findings + evidence of the steps this task depends on;
5. budget: approximate tokens as ceil(len(json) / 4) and trim the least useful
   parts first when over requirements.maxTokens.

Every step appends a ContextDecision, so the Phase 10 trace view can show why a
table or a history row was (not) handed to the agent. Everything here is
deterministic except contextId and assembledAt.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from helix_contracts import (
    AssembledContext,
    ContextAssembleRequest,
    ContextDecision,
    ContextFocus,
    ContextHistory,
    ContextUpstream,
    DataSourceContext,
    InvestigationRunInvestigation,
    RunEvidence,
    TableSchema,
)

from .history import HistoryError, HistorySource

logger = logging.getLogger(__name__)

SOURCE = "context-engine"

#: Evidence kinds whose `date` is an anomaly day worth explaining.
_FOCUS_KINDS = ("anomaly", "segment")
_SEVERITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}

# Same vocabulary as the Analytics planner's direction hint.
_DROP_RE = re.compile(
    r"\b(drop\w*|declin\w*|fall|fell|falling|decreas\w*|down|dip\w*|lower|loss|plung\w*|slump\w*)\b",
    re.IGNORECASE,
)
_SPIKE_RE = re.compile(
    r"\b(spik\w*|surg\w*|increas\w*|jump\w*|rise|rising|rose|higher|grow\w*|soar\w*)\b",
    re.IGNORECASE,
)


def question_direction(question: str) -> str | None:
    """"drop" or "spike" when the question says which way the metric moved."""
    drop, spike = _DROP_RE.search(question or ""), _SPIKE_RE.search(question or "")
    if drop and spike:
        return "drop" if drop.start() < spike.start() else "spike"
    return "drop" if drop else "spike" if spike else None


def estimate_tokens(context: AssembledContext) -> int:
    """Approximate token count: ceil(len(json) / 4)."""
    return math.ceil(len(context.model_dump_json(by_alias=True)) / 4)


# ---------------------------------------------------------------------------
# 1. Data sources
# ---------------------------------------------------------------------------


def _table_label(source: DataSourceContext, table: TableSchema) -> str:
    return f"{source.name}.{table.table_name}"


def _keyword_hits(table: TableSchema, keywords: list[str]) -> int:
    """Keyword hits for one table: 2 per keyword in the table name, 1 per keyword
    found only in a column name."""
    name = table.table_name.lower()
    columns = [c.name.lower() for c in table.columns]
    hits = 0
    for keyword in (k.lower() for k in keywords if k):
        if keyword in name:
            hits += 2
        elif any(keyword in column for column in columns):
            hits += 1
    return hits


def filter_data_sources(
    request: ContextAssembleRequest,
) -> tuple[list[DataSourceContext], list[ContextDecision]]:
    req = request.requirements
    decisions: list[ContextDecision] = []
    sources = list(request.data_sources)

    # -- type ---------------------------------------------------------------
    if req.data_source_types is not None:
        wanted = set(req.data_source_types)
        kept = [s for s in sources if s.type in wanted]
        dropped = [s for s in sources if s.type not in wanted]
        decisions.append(
            ContextDecision(
                rule="data_source_type",
                kept=[s.name for s in kept],
                dropped=[s.name for s in dropped],
                reason="Agent only reads data sources of type "
                + ", ".join(sorted(t.value for t in wanted))
                + ".",
            )
        )
        sources = kept

    # -- semantic types -------------------------------------------------------
    # A source without any discovered schema is kept as is (nothing to filter).
    if req.semantic_types:
        wanted_types = set(req.semantic_types)
        kept_labels: list[str] = []
        dropped_labels: list[str] = []
        filtered: list[DataSourceContext] = []
        for source in sources:
            if not source.schemas:
                filtered.append(source)
                continue
            tables = []
            for table in source.schemas:
                if any(c.semantic_type in wanted_types for c in table.columns):
                    tables.append(table)
                    kept_labels.append(_table_label(source, table))
                else:
                    dropped_labels.append(_table_label(source, table))
            if tables:
                filtered.append(source.model_copy(update={"schemas": tables}))
        decisions.append(
            ContextDecision(
                rule="semantic_types",
                kept=kept_labels,
                dropped=dropped_labels,
                reason="Kept tables with at least one column of semantic type "
                + ", ".join(req.semantic_types)
                + ".",
            )
        )
        sources = filtered

    # -- keywords ------------------------------------------------------------
    if req.table_keywords:
        scored = [
            (source, [(t, _keyword_hits(t, req.table_keywords)) for t in source.schemas])
            for source in sources
        ]
        any_hit = any(hits > 0 for _, tables in scored for _, hits in tables)
        if not any_hit:
            decisions.append(
                ContextDecision(
                    rule="table_keywords",
                    kept=[_table_label(s, t) for s in sources for t in s.schemas],
                    reason="No table matches "
                    + ", ".join(req.table_keywords)
                    + "; keyword filtering skipped so the semantic matches are kept.",
                )
            )
        else:
            kept_labels, dropped_labels = [], []
            ranked: list[tuple[int, int, DataSourceContext]] = []
            for index, (source, tables) in enumerate(scored):
                if not source.schemas:
                    # No schema to judge: keep it, ranked last.
                    ranked.append((0, index, source))
                    continue
                hits_tables = sorted(
                    ((t, h) for t, h in tables if h > 0), key=lambda pair: -pair[1]
                )
                dropped_labels += [_table_label(source, t) for t, h in tables if h == 0]
                if not hits_tables:
                    continue
                kept_labels += [_table_label(source, t) for t, _ in hits_tables]
                ranked.append(
                    (
                        hits_tables[0][1],
                        index,
                        source.model_copy(update={"schemas": [t for t, _ in hits_tables]}),
                    )
                )
            ranked.sort(key=lambda item: (-item[0], item[1]))
            sources = [source for _, _, source in ranked]
            decisions.append(
                ContextDecision(
                    rule="table_keywords",
                    kept=kept_labels,
                    dropped=dropped_labels,
                    reason="Kept and ranked tables whose name or columns mention "
                    + ", ".join(req.table_keywords)
                    + ".",
                )
            )

    return sources, decisions


# ---------------------------------------------------------------------------
# 2. Focus
# ---------------------------------------------------------------------------


def _severity_key(evidence: RunEvidence) -> tuple[int, float, float]:
    data = evidence.data
    severity = _SEVERITY_RANK.get(str(data.get("severity", "")).upper(), 0)
    try:
        deviation = abs(float(data.get("deviationScore") or 0.0))
    except (TypeError, ValueError):
        deviation = 0.0
    return (severity, deviation, evidence.confidence)


def _append_unique(items: list[str], value: Any) -> None:
    if isinstance(value, str) and value and value not in items:
        items.append(value)


def extract_focus(
    investigation: InvestigationRunInvestigation, upstream: ContextUpstream
) -> tuple[ContextFocus, ContextDecision]:
    trigger = investigation.trigger_context or {}
    dates: list[str] = []
    metric_keys: list[str] = []
    direction: str | None = None
    origins: list[str] = []

    if trigger:
        _append_unique(dates, str(trigger.get("date") or "")[:10])
        _append_unique(metric_keys, trigger.get("metricKey"))
        if trigger.get("direction") in ("drop", "spike"):
            direction = trigger["direction"]
        origins.append("trigger")

    focus_evidence = sorted(
        (e for e in upstream.evidence if e.data.get("kind") in _FOCUS_KINDS),
        key=_severity_key,
        reverse=True,
    )
    if direction is None:
        direction = question_direction(investigation.question)
    if direction is None:
        direction = next(
            (
                e.data["direction"]
                for e in focus_evidence
                if e.data.get("direction") in ("drop", "spike")
            ),
            None,
        )
    # Only days that move the way the investigation is about (a revenue drop
    # question should not send agents to explain a spike), and only serious
    # ones (HIGH/CRITICAL) unless nothing serious was found.
    aligned = [
        e for e in focus_evidence
        if direction is None or e.data.get("direction") in (None, direction)
    ]
    serious = [e for e in aligned if _severity_key(e)[0] >= _SEVERITY_RANK["HIGH"]]
    skipped = [
        str(e.data.get("date") or "")[:10]
        for e in focus_evidence
        if e not in (serious or aligned)
    ]
    for evidence in serious or aligned:
        _append_unique(dates, str(evidence.data.get("date") or "")[:10])
    # metricKeys: the most important evidence first, then the rest in upstream order.
    for evidence in [*focus_evidence, *upstream.evidence]:
        _append_unique(metric_keys, evidence.data.get("metricKey"))
    if focus_evidence:
        origins.append(f"{len(focus_evidence)} upstream anomaly/segment evidence")

    focus = ContextFocus(anomaly_dates=dates, metric_keys=metric_keys, direction=direction)
    dropped = sorted({d for d in skipped if d and d not in dates})
    if dropped:
        origins.append(
            f"skipping {', '.join(dropped)} (other direction or below HIGH severity)"
        )
    decision = ContextDecision(
        rule="focus",
        kept=[*dates, *metric_keys] + ([direction] if direction else []),
        dropped=dropped,
        reason=(
            "Focus derived from " + " and ".join(origins) + "."
            if origins
            else "No trigger context or upstream anomaly evidence; the agent picks its own focus."
        ),
    )
    return focus, decision


# ---------------------------------------------------------------------------
# 3. History
# ---------------------------------------------------------------------------

_HISTORY_TIME_KEYS = {
    "recent_metrics": "computedAt",
    "recent_anomalies": "detectedAt",
    "past_findings": "createdAt",
}


def _newest_first(rows: list[dict[str, Any]], time_key: str) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: str(row.get(time_key) or ""), reverse=True)


async def fetch_history(
    request: ContextAssembleRequest,
    investigation: InvestigationRunInvestigation,
    sources: list[DataSourceContext],
    history: HistorySource | None,
) -> tuple[ContextHistory, ContextDecision]:
    req = request.requirements
    if not req.include_history:
        return ContextHistory(), ContextDecision(
            rule="history", reason="Agent does not ask for history."
        )
    if history is None:
        return ContextHistory(), ContextDecision(
            rule="history", reason="No history source configured; history left empty."
        )
    try:
        body = await history.fetch(
            investigation.organization_id,
            data_source_ids=[s.id for s in sources],
            since_days=req.history_days,
            exclude_investigation_id=investigation.id,
        )
    except HistoryError as exc:
        logger.warning("History fetch for investigation %s failed: %s", investigation.id, exc)
        return ContextHistory(), ContextDecision(
            rule="history", reason=f"History unavailable ({exc}); continuing without it."
        )
    result = ContextHistory(
        recent_metrics=_newest_first(body.get("metrics", []), "computedAt"),
        recent_anomalies=_newest_first(body.get("anomalies", []), "detectedAt"),
        past_findings=_newest_first(body.get("findings", []), "createdAt"),
    )
    return result, ContextDecision(
        rule="history",
        kept=[
            f"{len(result.recent_metrics)} metrics",
            f"{len(result.recent_anomalies)} anomalies",
            f"{len(result.past_findings)} findings",
        ],
        reason=f"Recent organization history from the last {req.history_days} days.",
    )


# ---------------------------------------------------------------------------
# 5. Budget
# ---------------------------------------------------------------------------


def apply_budget(context: AssembledContext, max_tokens: int) -> AssembledContext:
    """Trim `context` until it fits `max_tokens`: history findings, then anomalies,
    then metrics (oldest first), then the per-dimension details of upstream
    evidence (oldest first). Records one `budget` decision."""
    tokens = estimate_tokens(context)
    if tokens <= max_tokens:
        context.decisions.append(
            ContextDecision(
                rule="budget",
                reason=f"About {tokens} tokens, within the {max_tokens} token budget.",
            )
        )
        return context

    start = tokens
    dropped: list[str] = []
    for attr in ("past_findings", "recent_anomalies", "recent_metrics"):
        rows: list[dict[str, Any]] = getattr(context.history, attr)
        rows[:] = _newest_first(rows, _HISTORY_TIME_KEYS[attr])
        removed = 0
        while rows and tokens > max_tokens:
            rows.pop()  # oldest is last
            removed += 1
            tokens = estimate_tokens(context)
        if removed:
            dropped.append(f"{removed} history {attr.split('_', 1)[1]}")
        if tokens <= max_tokens:
            break

    if tokens > max_tokens:
        stripped = 0
        for index in sorted(
            range(len(context.upstream.evidence)),
            key=lambda i: context.upstream.evidence[i].collected_at,
        ):
            evidence = context.upstream.evidence[index]
            if "dimensions" not in evidence.data:
                continue
            data = {k: v for k, v in evidence.data.items() if k != "dimensions"}
            context.upstream.evidence[index] = evidence.model_copy(update={"data": data})
            stripped += 1
            tokens = estimate_tokens(context)
            if tokens <= max_tokens:
                break
        if stripped:
            dropped.append(f"dimension details of {stripped} upstream evidence")

    context.truncated = True
    over = "" if tokens <= max_tokens else " Still over budget after trimming everything optional."
    context.decisions.append(
        ContextDecision(
            rule="budget",
            dropped=dropped,
            reason=f"About {start} tokens exceeded the {max_tokens} token budget; trimmed to "
            f"about {tokens}.{over}",
        )
    )
    return context


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


async def assemble(
    request: ContextAssembleRequest, *, history: HistorySource | None = None
) -> AssembledContext:
    investigation = InvestigationRunInvestigation.model_validate(request.investigation)
    req = request.requirements
    decisions: list[ContextDecision] = []

    sources, source_decisions = filter_data_sources(request)
    decisions += source_decisions

    focus, focus_decision = extract_focus(investigation, request.upstream)
    decisions.append(focus_decision)

    past, history_decision = await fetch_history(request, investigation, sources, history)
    decisions.append(history_decision)

    if req.include_upstream:
        upstream = request.upstream.model_copy(deep=True)
        decisions.append(
            ContextDecision(
                rule="upstream",
                kept=[
                    f"{len(upstream.findings)} findings",
                    f"{len(upstream.evidence)} evidence",
                ],
                reason="Findings and evidence of the steps this task depends on.",
            )
        )
    else:
        upstream = ContextUpstream()
        dropped = [
            f"{len(request.upstream.findings)} findings",
            f"{len(request.upstream.evidence)} evidence",
        ]
        decisions.append(
            ContextDecision(
                rule="upstream",
                dropped=dropped if request.upstream.findings or request.upstream.evidence else [],
                reason="Agent does not ask for upstream results.",
            )
        )

    context = AssembledContext(
        context_id=uuid4(),
        source=SOURCE,
        assembled_at=datetime.now(UTC),
        agent_type=request.agent_type,
        agent_task_id=request.agent_task_id,
        question=investigation.question,
        investigation_id=investigation.id,
        organization_id=investigation.organization_id,
        project_id=investigation.project_id,
        trigger_type=investigation.trigger_type,
        step=request.step,
        data_sources=sources,
        trigger_context=investigation.trigger_context,
        focus=focus,
        history=past,
        upstream=upstream,
        decisions=decisions,
    )
    context = apply_budget(context, req.max_tokens)
    context.token_count = estimate_tokens(context)
    return context
