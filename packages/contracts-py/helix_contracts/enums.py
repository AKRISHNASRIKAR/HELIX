"""Mirrors packages/types/src/enums.ts — keep both in sync by hand until a
codegen step is introduced (see docs/decisions for the ADR on contract sharing)."""

from enum import StrEnum


class InvestigationStatus(StrEnum):
    PENDING = "PENDING"
    PLANNING = "PLANNING"
    IN_PROGRESS = "IN_PROGRESS"
    AWAITING_EVIDENCE = "AWAITING_EVIDENCE"
    COMPLETED = "COMPLETED"
    PARTIALLY_COMPLETED = "PARTIALLY_COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class InvestigationTriggerType(StrEnum):
    USER_QUESTION = "USER_QUESTION"
    ANOMALY_DETECTED = "ANOMALY_DETECTED"
    SCHEDULED = "SCHEDULED"
    MANUAL = "MANUAL"


class AgentTaskStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"
    SKIPPED = "SKIPPED"


class AgentType(StrEnum):
    COORDINATOR = "COORDINATOR"
    ANALYTICS = "ANALYTICS"
    FINANCE = "FINANCE"
    CUSTOMER = "CUSTOMER"
    PRODUCT = "PRODUCT"
    OPERATIONS = "OPERATIONS"
    VISUALIZATION = "VISUALIZATION"


class AgentStatus(StrEnum):
    IDLE = "IDLE"
    BUSY = "BUSY"
    UNAVAILABLE = "UNAVAILABLE"


class AgentMessageType(StrEnum):
    TASK_REQUEST = "TASK_REQUEST"
    TASK_RESULT = "TASK_RESULT"
    STATUS_UPDATE = "STATUS_UPDATE"
    ERROR = "ERROR"
    CONTEXT_REQUEST = "CONTEXT_REQUEST"
    CONTEXT_RESPONSE = "CONTEXT_RESPONSE"


class DataSourceType(StrEnum):
    POSTGRESQL = "POSTGRESQL"
    CSV = "CSV"
    REST_API = "REST_API"
    GITHUB = "GITHUB"
    MCP = "MCP"


class DataSourceStatus(StrEnum):
    PENDING = "PENDING"
    CONNECTED = "CONNECTED"
    ERROR = "ERROR"
    DISABLED = "DISABLED"


class EvidenceSourceType(StrEnum):
    METRIC = "METRIC"
    DATABASE_QUERY = "DATABASE_QUERY"
    DOCUMENT = "DOCUMENT"
    API_RESPONSE = "API_RESPONSE"
    ANOMALY = "ANOMALY"


class AnalyticsType(StrEnum):
    DESCRIPTIVE = "DESCRIPTIVE"
    DIAGNOSTIC = "DIAGNOSTIC"
    PREDICTIVE = "PREDICTIVE"
    PRESCRIPTIVE = "PRESCRIPTIVE"


class RecommendationPriority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AnomalySeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"
