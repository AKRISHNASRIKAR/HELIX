"""Defensive parsing of AgentTask.inputContext for every engine-backed agent.

Since Phase 6 the inputContext is an AssembledContext (helix_contracts.context)
built by services/context-engine; Phase 5 hand-assembled contexts (question,
organizationId, dataSources) are a subset of it. Only the keys the agents use
are read, unknown keys are ignored, and a malformed optional section (focus,
upstream) is dropped instead of failing the task.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from helix_contracts import AgentTask, DataSourceContext
from pydantic import ValidationError

from .planner import NoUsableDatasetError

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")


@dataclass
class TaskContext:
    question: str
    organization_id: str
    data_sources: list[DataSourceContext]
    #: ISO days to explain, most important first (AssembledContext.focus.anomalyDates).
    focus_dates: list[str] = field(default_factory=list)
    focus_metric_keys: list[str] = field(default_factory=list)
    focus_direction: str | None = None
    #: Upstream evidence as raw JSON dicts (camelCase), for topSlice values etc.
    upstream_evidence: list[dict[str, Any]] = field(default_factory=list)
    trigger_context: dict[str, Any] | None = None

    def upstream_top_slices(self, date: str | None = None) -> list[dict[str, Any]]:
        """topSlice dicts of upstream segment/segment_volume evidence (optionally on `date`)."""
        slices = []
        for item in self.upstream_evidence:
            data = item.get("data") if isinstance(item, dict) else None
            if not isinstance(data, dict) or data.get("kind") not in ("segment", "segment_volume"):
                continue
            top = data.get("topSlice")
            if not isinstance(top, dict) or top.get("value") is None:
                continue
            if date is not None and str(data.get("date") or "")[:10] != date:
                continue
            slices.append(top)
        return slices

    def upstream_metric_name(self, metric_key: str) -> str | None:
        """metricName of an upstream anomaly on `metric_key` (e.g. "revenue")."""
        for item in self.upstream_evidence:
            data = item.get("data") if isinstance(item, dict) else None
            if (
                isinstance(data, dict)
                and data.get("kind") == "anomaly"
                and data.get("metricKey") == metric_key
                and data.get("metricName")
            ):
                return str(data["metricName"])
        return None


def _get(ctx: dict[str, Any], camel: str, snake: str) -> Any:
    return ctx.get(camel) if camel in ctx else ctx.get(snake)


def _iso_days(values: Any) -> list[str]:
    days: list[str] = []
    for value in values if isinstance(values, list) else []:
        text = str(value)
        if _ISO_DAY.match(text) and text[:10] not in days:
            days.append(text[:10])
    return days


def parse_task_context(task: AgentTask) -> TaskContext:
    """Raises NoUsableDatasetError when dataSources is malformed or organizationId is missing."""
    ctx = task.input_context or {}
    raw_sources = _get(ctx, "dataSources", "data_sources") or []
    try:
        sources = [DataSourceContext.model_validate(s) for s in raw_sources]
    except ValidationError as exc:
        raise NoUsableDatasetError(
            f"inputContext.dataSources is malformed: {exc.error_count()} validation error(s)."
        ) from exc
    organization_id = _get(ctx, "organizationId", "organization_id")
    if not organization_id:
        raise NoUsableDatasetError(
            "inputContext.organizationId is required to fetch data for analysis."
        )

    focus = ctx.get("focus") if isinstance(ctx.get("focus"), dict) else {}
    metric_keys = _get(focus, "metricKeys", "metric_keys")
    direction = focus.get("direction")
    upstream = ctx.get("upstream") if isinstance(ctx.get("upstream"), dict) else {}
    evidence = upstream.get("evidence")
    trigger = _get(ctx, "triggerContext", "trigger_context")
    return TaskContext(
        question=str(ctx.get("question") or task.objective),
        organization_id=str(organization_id),
        data_sources=sources,
        focus_dates=_iso_days(_get(focus, "anomalyDates", "anomaly_dates")),
        focus_metric_keys=[str(k) for k in metric_keys] if isinstance(metric_keys, list) else [],
        focus_direction=direction if direction in ("drop", "spike") else None,
        upstream_evidence=[e for e in evidence if isinstance(e, dict)]
        if isinstance(evidence, list)
        else [],
        trigger_context=trigger if isinstance(trigger, dict) else None,
    )
