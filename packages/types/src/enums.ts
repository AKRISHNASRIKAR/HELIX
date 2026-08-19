/**
 * Shared enums for HELIX domain entities.
 * These mirror the Postgres enum types defined in packages/database/prisma/schema.prisma
 * and the Python enums in each service's domain module — keep all three in sync.
 */

export enum InvestigationStatus {
  PENDING = 'PENDING',
  PLANNING = 'PLANNING',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_EVIDENCE = 'AWAITING_EVIDENCE',
  COMPLETED = 'COMPLETED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum InvestigationTriggerType {
  USER_QUESTION = 'USER_QUESTION',
  ANOMALY_DETECTED = 'ANOMALY_DETECTED',
  SCHEDULED = 'SCHEDULED',
  MANUAL = 'MANUAL',
}

export enum AgentTaskStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMED_OUT = 'TIMED_OUT',
  SKIPPED = 'SKIPPED',
}

export enum AgentType {
  COORDINATOR = 'COORDINATOR',
  ANALYTICS = 'ANALYTICS',
  FINANCE = 'FINANCE',
  CUSTOMER = 'CUSTOMER',
  PRODUCT = 'PRODUCT',
  OPERATIONS = 'OPERATIONS',
  VISUALIZATION = 'VISUALIZATION',
}

export enum AgentStatus {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum AgentMessageType {
  TASK_REQUEST = 'TASK_REQUEST',
  TASK_RESULT = 'TASK_RESULT',
  STATUS_UPDATE = 'STATUS_UPDATE',
  ERROR = 'ERROR',
  CONTEXT_REQUEST = 'CONTEXT_REQUEST',
  CONTEXT_RESPONSE = 'CONTEXT_RESPONSE',
}

export enum DataSourceType {
  POSTGRESQL = 'POSTGRESQL',
  CSV = 'CSV',
  REST_API = 'REST_API',
  GITHUB = 'GITHUB',
  MCP = 'MCP',
}

export enum DataSourceStatus {
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  DISABLED = 'DISABLED',
}

export enum EvidenceSourceType {
  METRIC = 'METRIC',
  DATABASE_QUERY = 'DATABASE_QUERY',
  DOCUMENT = 'DOCUMENT',
  API_RESPONSE = 'API_RESPONSE',
  ANOMALY = 'ANOMALY',
}

export enum AnalyticsType {
  DESCRIPTIVE = 'DESCRIPTIVE',
  DIAGNOSTIC = 'DIAGNOSTIC',
  PREDICTIVE = 'PREDICTIVE',
  PRESCRIPTIVE = 'PRESCRIPTIVE',
}

export enum RecommendationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum OrganizationRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}
