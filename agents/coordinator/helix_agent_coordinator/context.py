"""Context assembly for each AgentTask (Phase 6).

The Coordinator asks an injected ContextProvider (agent-runtime wires an HTTP
client for services/context-engine) for each task's AssembledContext. When no
provider is configured, or it raises, the Coordinator hand-assembles one
locally (`source="fallback"`) so the run continues; the synthesis step's
context is always assembled locally (`source="coordinator"`).
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from helix_contracts import (
    AgentType,
    AssembledContext,
    ContextAssembleRequest,
    ContextDecision,
    ContextFocus,
    ContextRequirements,
    ContextUpstream,
    DataSourceType,
    InvestigationRunInvestigation,
    RunEvidence,
)


class ContextProvider(Protocol):
    async def assemble(self, request: ContextAssembleRequest) -> AssembledContext: ...


#: Requirements per agent type, used when the runtime does not pass the
#: registered agents' own `context_requirements` (spec section 5).
DEFAULT_REQUIREMENTS: dict[AgentType, ContextRequirements] = {
    AgentType.ANALYTICS: ContextRequirements(
        semanticTypes=["datetime", "currency", "numeric", "categorical", "identifier"],
        includeUpstream=False,
    ),
    AgentType.FINANCE: ContextRequirements(
        semanticTypes=["datetime", "currency", "categorical"],
        tableKeywords=["order", "payment", "refund", "transaction", "invoice", "charge"],
    ),
    AgentType.CUSTOMER: ContextRequirements(
        semanticTypes=["datetime", "identifier", "categorical"],
        tableKeywords=["customer", "user", "order", "account"],
    ),
    AgentType.PRODUCT: ContextRequirements(
        dataSourceTypes=[DataSourceType.MCP, DataSourceType.GITHUB],
        tableKeywords=["deploy", "release", "commit", "change"],
        semanticTypes=["datetime"],
    ),
}

_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def token_count(payload: dict[str, Any]) -> int:
    """Same estimate as the context engine: ceil(len(json) / 4)."""
    return math.ceil(len(json.dumps(payload, default=str)) / 4)


def focus_from(
    upstream_evidence: list[RunEvidence], trigger_context: dict[str, Any] | None
) -> ContextFocus:
    """anomalyDates (most severe first), metricKeys and direction from upstream
    `anomaly` / `segment` evidence plus the trigger."""
    trigger = trigger_context or {}
    dated = [
        e for e in upstream_evidence
        if (e.data or {}).get("kind") in ("anomaly", "segment") and e.data.get("date")
    ]
    dated.sort(
        key=lambda e: (
            _SEVERITY_RANK.get(str(e.data.get("severity") or "").upper(), 4),
            -abs(float(e.data.get("deviationScore") or 0.0)),
        )
    )
    dates: list[str] = []
    for e in dated:
        day = str(e.data["date"])[:10]
        if day not in dates:
            dates.append(day)
    if trigger.get("date") and str(trigger["date"])[:10] not in dates:
        dates.append(str(trigger["date"])[:10])

    keys: list[str] = []
    for key in [trigger.get("metricKey"), *(e.data.get("metricKey") for e in upstream_evidence)]:
        if key and key not in keys:
            keys.append(key)
    direction = trigger.get("direction") or next(
        (e.data.get("direction") for e in dated if e.data.get("direction")), None
    )
    return ContextFocus(anomalyDates=dates, metricKeys=keys, direction=direction)


def assemble_locally(
    request: ContextAssembleRequest,
    investigation: InvestigationRunInvestigation,
    *,
    source: str,
    reason: str,
) -> AssembledContext:
    """Hand-assembled context: every connected data source, upstream as given
    (when the requirements ask for it), focus derived locally, no history."""
    upstream = request.upstream if request.requirements.include_upstream else ContextUpstream()
    decisions = [ContextDecision(rule=source, reason=reason)]
    if not request.requirements.include_upstream and (
        request.upstream.findings or request.upstream.evidence
    ):
        decisions.append(
            ContextDecision(rule="upstream", reason="This agent does not take upstream results.")
        )
    context = AssembledContext(
        contextId=uuid4(),
        source=source,
        assembledAt=datetime.now(UTC),
        agentType=request.agent_type,
        agentTaskId=request.agent_task_id,
        question=investigation.question,
        investigationId=investigation.id,
        organizationId=investigation.organization_id,
        projectId=investigation.project_id,
        triggerType=investigation.trigger_type,
        step=request.step,
        dataSources=request.data_sources,
        triggerContext=investigation.trigger_context,
        focus=focus_from(request.upstream.evidence, investigation.trigger_context),
        upstream=upstream,
        decisions=decisions,
    )
    context.token_count = token_count(context.model_dump(mode="json", by_alias=True))
    return context
