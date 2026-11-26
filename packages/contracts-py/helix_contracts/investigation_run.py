"""Wire contract for agent-runtime's POST /investigations/run (Phase 5).

The API sends an InvestigationRunRequest (the investigation plus the org's
CONNECTED data sources and their discovered schemas) and persists the returned
InvestigationRunResult as-is, ids included. Every id in the result is a UUIDv4
generated in Python, and every cross-reference (stepId, agentTaskId,
evidenceIds, findingIds, data.metricId, data.anomalyId) points at another item
in the same result.

These models intentionally differ from the per-entity models in models.py:
they omit investigationId/organizationId (implied by the request) and carry
the linking ids the API needs to write one consistent transaction.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .enums import (
    AgentMessageType,
    AgentTaskStatus,
    AgentType,
    AnalyticsType,
    AnomalySeverity,
    DataSourceType,
    EvidenceSourceType,
    InvestigationTriggerType,
    RecommendationPriority,
)
from .models import InvestigationPlan, MetricDataPoint

_CAMEL = ConfigDict(populate_by_name=True)

RunStatus = Literal["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"]


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class ColumnSchema(BaseModel):
    model_config = _CAMEL

    name: str
    type: str
    nullable: bool = True
    #: One of datetime|currency|numeric|identifier|categorical|boolean|email|text
    #: (ingestion-service). Optional because older schemas may lack it.
    semantic_type: str | None = Field(default=None, alias="semanticType")


class TableSchema(BaseModel):
    model_config = _CAMEL

    table_name: str = Field(alias="tableName")
    columns: list[ColumnSchema] = Field(default_factory=list)
    row_count_estimate: int | None = Field(default=None, alias="rowCountEstimate")


class DataSourceContext(BaseModel):
    """A CONNECTED data source as handed to agents: identity plus discovered schema."""

    model_config = _CAMEL

    id: UUID
    name: str
    type: DataSourceType
    schemas: list[TableSchema] = Field(default_factory=list)


class InvestigationRunInvestigation(BaseModel):
    model_config = _CAMEL

    id: UUID
    organization_id: UUID = Field(alias="organizationId")
    project_id: UUID = Field(alias="projectId")
    question: str
    trigger_type: InvestigationTriggerType = Field(
        default=InvestigationTriggerType.USER_QUESTION, alias="triggerType"
    )
    #: Phase 9: for ANOMALY_DETECTED investigations, the anomaly that triggered
    #: it ({monitorId, metricKey, metricName, date, direction, severity, value,
    #: expectedValue, deviationScore, dataSourceId, table}). None otherwise.
    trigger_context: dict[str, Any] | None = Field(default=None, alias="triggerContext")


class InvestigationRunRequest(BaseModel):
    model_config = _CAMEL

    investigation: InvestigationRunInvestigation
    data_sources: list[DataSourceContext] = Field(default_factory=list, alias="dataSources")


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


class RunStep(BaseModel):
    model_config = _CAMEL

    id: UUID
    order: int
    agent_type: AgentType = Field(alias="agentType")
    objective: str
    depends_on: list[int] = Field(default_factory=list, alias="dependsOn")


class RunTask(BaseModel):
    model_config = _CAMEL

    id: UUID
    step_id: UUID = Field(alias="stepId")
    agent_type: AgentType = Field(alias="agentType")
    status: AgentTaskStatus
    objective: str
    input_context: dict[str, Any] = Field(default_factory=dict, alias="inputContext")
    result: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    timeout_ms: int = Field(default=60_000, alias="timeoutMs")


class EvidenceSource(BaseModel):
    model_config = _CAMEL

    data_source_id: UUID | None = Field(default=None, alias="dataSourceId")
    agent_task_id: UUID | None = Field(default=None, alias="agentTaskId")
    description: str


class RunEvidence(BaseModel):
    model_config = _CAMEL

    id: UUID
    agent_task_id: UUID = Field(alias="agentTaskId")
    source_type: EvidenceSourceType = Field(alias="sourceType")
    source: EvidenceSource
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0, le=1)
    collected_at: datetime = Field(alias="collectedAt")


class RunFinding(BaseModel):
    model_config = _CAMEL

    id: UUID
    agent_task_id: UUID = Field(alias="agentTaskId")
    agent_type: AgentType = Field(alias="agentType")
    analytics_type: AnalyticsType = Field(alias="analyticsType")
    statement: str
    confidence: float = Field(ge=0, le=1)
    is_root_cause: bool = Field(default=False, alias="isRootCause")
    evidence_ids: list[UUID] = Field(default_factory=list, alias="evidenceIds")


class RunRecommendation(BaseModel):
    model_config = _CAMEL

    id: UUID
    title: str
    description: str
    priority: RecommendationPriority
    expected_impact: str | None = Field(default=None, alias="expectedImpact")
    finding_ids: list[UUID] = Field(default_factory=list, alias="findingIds")


class RunMetric(BaseModel):
    model_config = _CAMEL

    id: UUID
    data_source_id: UUID | None = Field(default=None, alias="dataSourceId")
    name: str
    unit: str | None = None
    value: float
    baseline: float | None = None
    change_percent: float | None = Field(default=None, alias="changePercent")
    series: list[MetricDataPoint] | None = None
    computation_method: str = Field(min_length=1, alias="computationMethod")
    computed_at: datetime = Field(alias="computedAt")


class RunAnomaly(BaseModel):
    model_config = _CAMEL

    id: UUID
    metric_id: UUID | None = Field(default=None, alias="metricId")
    data_source_id: UUID | None = Field(default=None, alias="dataSourceId")
    description: str
    severity: AnomalySeverity
    #: The (UTC day) timestamp the anomalous value belongs to.
    detected_at: datetime = Field(alias="detectedAt")
    detection_method: str = Field(alias="detectionMethod")
    value: float
    expected_value: float | None = Field(default=None, alias="expectedValue")
    deviation_score: float | None = Field(default=None, alias="deviationScore")


class RunMessage(BaseModel):
    """One A2A message (Phase 7), persisted as an AgentMessage row."""

    model_config = _CAMEL

    id: UUID
    type: AgentMessageType
    agent_task_id: UUID | None = Field(default=None, alias="agentTaskId")
    from_agent: str = Field(alias="fromAgent")
    to_agent: str = Field(alias="toAgent")
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str = Field(alias="correlationId")
    created_at: datetime = Field(alias="createdAt")


class RunContextSnapshot(BaseModel):
    """The exact context one task received (Phase 6), persisted as a ContextSnapshot row."""

    model_config = _CAMEL

    id: UUID
    agent_task_id: UUID | None = Field(default=None, alias="agentTaskId")
    agent_type: AgentType = Field(alias="agentType")
    assembled_context: dict[str, Any] = Field(alias="assembledContext")
    token_count: int | None = Field(default=None, alias="tokenCount")
    created_at: datetime = Field(alias="createdAt")


class InvestigationRunResult(BaseModel):
    model_config = _CAMEL

    status: RunStatus
    plan: InvestigationPlan
    steps: list[RunStep] = Field(default_factory=list)
    tasks: list[RunTask] = Field(default_factory=list)
    evidence: list[RunEvidence] = Field(default_factory=list)
    findings: list[RunFinding] = Field(default_factory=list)
    recommendations: list[RunRecommendation] = Field(default_factory=list)
    metrics: list[RunMetric] = Field(default_factory=list)
    anomalies: list[RunAnomaly] = Field(default_factory=list)
    summary: str | None = None
    overall_confidence: float | None = Field(default=None, ge=0, le=1, alias="overallConfidence")
    root_cause_finding_id: UUID | None = Field(default=None, alias="rootCauseFindingId")
    messages: list[RunMessage] = Field(default_factory=list)
    context_snapshots: list[RunContextSnapshot] = Field(
        default_factory=list, alias="contextSnapshots"
    )
    #: Free-form run metadata (planner/summary writer used, LLM model, timings).
    meta: dict[str, Any] = Field(default_factory=dict)
