"""Mirrors packages/contracts/src/*.ts (zod schemas). These are the shapes
Python services (agents, analytics engine) use to exchange structured
results with the Node API — see docs/architecture/analytics-engine.md for
why analytics results must be structured data, never free-text LLM output."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .enums import (
    AgentMessageType,
    AgentStatus,
    AgentTaskStatus,
    AgentType,
    AnalyticsType,
    DataSourceStatus,
    DataSourceType,
    EvidenceSourceType,
    InvestigationStatus,
    InvestigationTriggerType,
    RecommendationPriority,
)


class SourceRef(BaseModel):
    data_source_id: UUID | None = Field(default=None, alias="dataSourceId")
    agent_id: UUID | None = Field(default=None, alias="agentId")
    agent_task_id: UUID | None = Field(default=None, alias="agentTaskId")
    description: str

    model_config = {"populate_by_name": True}


class MetricDataPoint(BaseModel):
    timestamp: datetime
    value: float


class Metric(BaseModel):
    id: UUID
    organization_id: UUID = Field(alias="organizationId")
    data_source_id: UUID | None = Field(default=None, alias="dataSourceId")
    name: str
    unit: str | None = None
    value: float
    baseline: float | None = None
    change_percent: float | None = Field(default=None, alias="changePercent")
    series: list[MetricDataPoint] | None = None
    computed_at: datetime = Field(alias="computedAt")
    computation_method: str = Field(alias="computationMethod")

    model_config = {"populate_by_name": True}


class AgentCapability(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any] | None = Field(default=None, alias="inputSchema")
    output_schema: dict[str, Any] | None = Field(default=None, alias="outputSchema")

    model_config = {"populate_by_name": True}


class Agent(BaseModel):
    id: UUID
    type: AgentType
    name: str
    description: str
    version: str
    status: AgentStatus
    capabilities: list[AgentCapability]
    endpoint: str

    model_config = {"populate_by_name": True}


class AgentTask(BaseModel):
    id: UUID
    investigation_id: UUID = Field(alias="investigationId")
    agent_type: AgentType = Field(alias="agentType")
    agent_id: UUID | None = Field(default=None, alias="agentId")
    status: AgentTaskStatus
    objective: str
    input_context: dict[str, Any] = Field(default_factory=dict, alias="inputContext")
    result: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    timeout_ms: int = Field(default=60_000, alias="timeoutMs")

    model_config = {"populate_by_name": True}


class AgentMessage(BaseModel):
    id: UUID
    type: AgentMessageType
    investigation_id: UUID = Field(alias="investigationId")
    agent_task_id: UUID | None = Field(default=None, alias="agentTaskId")
    from_agent: AgentType = Field(alias="fromAgent")
    to_agent: AgentType | Literal["COORDINATOR"] = Field(alias="toAgent")
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: UUID = Field(alias="correlationId")

    model_config = {"populate_by_name": True}


class Evidence(BaseModel):
    id: UUID
    investigation_id: UUID = Field(alias="investigationId")
    agent_task_id: UUID = Field(alias="agentTaskId")
    source_type: EvidenceSourceType = Field(alias="sourceType")
    source: SourceRef
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0, le=1)
    collected_at: datetime = Field(alias="collectedAt")

    model_config = {"populate_by_name": True}


class Finding(BaseModel):
    id: UUID
    investigation_id: UUID = Field(alias="investigationId")
    agent_type: AgentType = Field(alias="agentType")
    analytics_type: AnalyticsType = Field(alias="analyticsType")
    statement: str
    evidence_ids: list[UUID] = Field(alias="evidenceIds")
    confidence: float = Field(ge=0, le=1)
    is_root_cause: bool = Field(default=False, alias="isRootCause")

    model_config = {"populate_by_name": True}


class Recommendation(BaseModel):
    id: UUID
    investigation_id: UUID = Field(alias="investigationId")
    finding_ids: list[UUID] = Field(alias="findingIds")
    title: str
    description: str
    priority: RecommendationPriority
    expected_impact: str | None = Field(default=None, alias="expectedImpact")

    model_config = {"populate_by_name": True}


class DataSource(BaseModel):
    id: UUID
    organization_id: UUID = Field(alias="organizationId")
    name: str
    type: DataSourceType
    status: DataSourceStatus
    connection_config: dict[str, Any] = Field(default_factory=dict, alias="connectionConfig")
    last_synced_at: datetime | None = Field(default=None, alias="lastSyncedAt")

    model_config = {"populate_by_name": True}


class InvestigationPlanStep(BaseModel):
    order: int
    agent_type: str = Field(alias="agentType")
    objective: str
    depends_on: list[int] = Field(default_factory=list, alias="dependsOn")

    model_config = {"populate_by_name": True}


class InvestigationPlan(BaseModel):
    steps: list[InvestigationPlanStep]
    reasoning: str | None = None


class Investigation(BaseModel):
    id: UUID
    organization_id: UUID = Field(alias="organizationId")
    project_id: UUID = Field(alias="projectId")
    created_by_user_id: UUID | None = Field(default=None, alias="createdByUserId")
    trigger_type: InvestigationTriggerType = Field(alias="triggerType")
    question: str
    status: InvestigationStatus
    plan: InvestigationPlan | None = None
    root_cause_finding_id: UUID | None = Field(default=None, alias="rootCauseFindingId")
    summary: str | None = None
    overall_confidence: float | None = Field(default=None, alias="overallConfidence")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")

    model_config = {"populate_by_name": True}
