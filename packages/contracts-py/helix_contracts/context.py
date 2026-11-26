"""Context Engine contracts (Phase 6).

Each agent declares the context it needs (ContextRequirements, a class
attribute on BaseAgent). Before dispatching an AgentTask the Coordinator asks
services/context-engine to assemble an AssembledContext for it; the result
becomes the task's inputContext and is persisted verbatim as a
ContextSnapshot row, so a finding can be traced back to exactly what the
agent saw (docs/architecture/context-engine.md).

AssembledContext is a superset of the Phase 5 hand-assembled inputContext
(question, investigationId, organizationId, projectId, triggerType, step,
dataSources), so agents written against Phase 5 keep working unchanged.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .enums import AgentType, DataSourceType, InvestigationTriggerType
from .investigation_run import DataSourceContext, RunEvidence, RunFinding

_CAMEL = ConfigDict(populate_by_name=True)


class ContextRequirements(BaseModel):
    """What one agent type needs from the Context Engine."""

    model_config = _CAMEL

    #: Column semanticTypes the agent works with (datetime, currency, categorical, ...).
    #: A table is relevant only if it has at least one of these. Empty = any table.
    semantic_types: list[str] = Field(default_factory=list, alias="semanticTypes")
    #: Table/column name hints ("order", "payment", "refund", "deploy").
    #: Tables matching a keyword rank first; when nothing matches, keyword
    #: filtering is skipped rather than dropping every table.
    table_keywords: list[str] = Field(default_factory=list, alias="tableKeywords")
    #: Only these data source types are relevant (None = any type).
    data_source_types: list[DataSourceType] | None = Field(default=None, alias="dataSourceTypes")
    #: Include recent Metric/Anomaly/Finding rows from earlier investigations.
    include_history: bool = Field(default=True, alias="includeHistory")
    history_days: int = Field(default=30, ge=1, le=365, alias="historyDays")
    #: Include findings/evidence from the plan steps this task depends on.
    include_upstream: bool = Field(default=True, alias="includeUpstream")
    #: Approximate token budget for the whole assembled context (len(json)/4).
    max_tokens: int = Field(default=8000, ge=500, le=200_000, alias="maxTokens")


class ContextFocus(BaseModel):
    """What the investigation is about, distilled from trigger + upstream results."""

    model_config = _CAMEL

    #: ISO days (YYYY-MM-DD) of anomalies this task should explain, most important first.
    anomaly_dates: list[str] = Field(default_factory=list, alias="anomalyDates")
    #: Metric keys in play (revenue, refunds, orders, ...).
    metric_keys: list[str] = Field(default_factory=list, alias="metricKeys")
    #: "drop" | "spike" | None
    direction: str | None = None


class ContextHistory(BaseModel):
    model_config = _CAMEL

    recent_metrics: list[dict[str, Any]] = Field(default_factory=list, alias="recentMetrics")
    recent_anomalies: list[dict[str, Any]] = Field(default_factory=list, alias="recentAnomalies")
    past_findings: list[dict[str, Any]] = Field(default_factory=list, alias="pastFindings")


class ContextUpstream(BaseModel):
    model_config = _CAMEL

    findings: list[RunFinding] = Field(default_factory=list)
    evidence: list[RunEvidence] = Field(default_factory=list)


class ContextDecision(BaseModel):
    """One filtering decision, kept for the Phase 10 context trace view."""

    model_config = _CAMEL

    rule: str
    kept: list[str] = Field(default_factory=list)
    dropped: list[str] = Field(default_factory=list)
    reason: str


class ContextStep(BaseModel):
    model_config = _CAMEL

    order: int
    objective: str


class AssembledContext(BaseModel):
    """The inputContext handed to one AgentTask (and persisted as a ContextSnapshot)."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    context_id: UUID = Field(alias="contextId")
    #: "context-engine" when assembled by the service, "fallback" when the
    #: Coordinator had to hand-assemble it (service unreachable).
    source: str = "context-engine"
    assembled_at: datetime = Field(alias="assembledAt")
    agent_type: AgentType = Field(alias="agentType")
    agent_task_id: UUID = Field(alias="agentTaskId")
    # -- Phase 5-compatible keys -------------------------------------------
    question: str
    investigation_id: UUID = Field(alias="investigationId")
    organization_id: UUID = Field(alias="organizationId")
    project_id: UUID = Field(alias="projectId")
    trigger_type: InvestigationTriggerType = Field(alias="triggerType")
    step: ContextStep
    data_sources: list[DataSourceContext] = Field(default_factory=list, alias="dataSources")
    # -- Phase 6 additions ---------------------------------------------------
    trigger_context: dict[str, Any] | None = Field(default=None, alias="triggerContext")
    focus: ContextFocus = Field(default_factory=ContextFocus)
    history: ContextHistory = Field(default_factory=ContextHistory)
    upstream: ContextUpstream = Field(default_factory=ContextUpstream)
    decisions: list[ContextDecision] = Field(default_factory=list)
    token_count: int | None = Field(default=None, alias="tokenCount")
    truncated: bool = False


class ContextAssembleRequest(BaseModel):
    """Body of context-engine's POST /context/assemble."""

    model_config = _CAMEL

    investigation: dict[str, Any]  # InvestigationRunInvestigation as JSON (camelCase)
    agent_task_id: UUID = Field(alias="agentTaskId")
    agent_type: AgentType = Field(alias="agentType")
    step: ContextStep
    requirements: ContextRequirements
    data_sources: list[DataSourceContext] = Field(default_factory=list, alias="dataSources")
    upstream: ContextUpstream = Field(default_factory=ContextUpstream)
