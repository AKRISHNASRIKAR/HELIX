import type { Investigation } from '@helix/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side API client. Every request carries the session's bearer token
 * and active organization (both read from httpOnly cookies set by the auth
 * server actions), so pages never handle credentials directly. No business
 * logic lives here; helpers return null / [] on failure so pages can render
 * graceful empty states when the API is unreachable.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TOKEN_COOKIE = 'helix_token';
export const ORG_COOKIE = 'helix_org';
/** Route handler that clears the session cookies and sends the user to /login. */
export const SESSION_EXPIRED_PATH = '/session/expired';

/** Demo mode (HELIX_DEMO=1): no auth, the API serves fixture data. */
export function isDemoMode(): boolean {
  return process.env.HELIX_DEMO === '1';
}

export interface RequestContext {
  token?: string;
  organizationId?: string;
}

/** Reads the session cookies for the current request. */
export async function readRequestContext(): Promise<RequestContext> {
  const store = await cookies();
  return {
    token: store.get(TOKEN_COOKIE)?.value || undefined,
    organizationId: store.get(ORG_COOKIE)?.value || undefined,
  };
}

/** Builds request headers: auth + tenant from the context, plus any extras. */
export function buildHeaders(ctx: RequestContext, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (ctx.token) headers.set('Authorization', `Bearer ${ctx.token}`);
  if (ctx.organizationId) headers.set('X-Organization-Id', ctx.organizationId);
  return headers;
}

/**
 * Turns an API error body into one readable sentence. Handles Nest's
 * `{ message: string | string[] }`, FastAPI's `{ detail }`, and plain text.
 */
export function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const msg = b.message ?? b.detail ?? b.error;
    if (Array.isArray(msg) && msg.length > 0) return msg.map(String).join('. ');
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (typeof body === 'string' && body.trim() && body.length < 300) return body;
  if (status === 0) return 'Could not reach the HELIX API. Check that it is running.';
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'Not found.';
  if (status === 409) return 'That conflicts with an existing record.';
  if (status === 413) return 'That file is too large.';
  return `Request failed (HTTP ${status}).`;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** JSON body (serialized and sent with a JSON content type). */
  json?: unknown;
  /** Raw body (e.g. FormData for multipart uploads). */
  body?: BodyInit;
  headers?: HeadersInit;
  /** Explicit context; defaults to the current request's cookies. */
  context?: RequestContext;
  /** Redirect to the session-expired handler on 401 (default true). */
  redirectOn401?: boolean;
}

/**
 * Low-level request against `/api/v1`. Never throws for HTTP or network
 * errors (returns `{ ok: false, error }`), except that a 401 for a signed-in
 * user redirects to re-authenticate (outside demo mode).
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { json, body, headers: extra, context, redirectOn401 = true, ...init } = options;
  const ctx = context ?? (await readRequestContext());
  const headers = buildHeaders(ctx, extra);
  if (json !== undefined) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      cache: 'no-store',
      ...init,
      headers,
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    return { ok: false, status: 0, error: extractErrorMessage(null, 0) };
  }

  const status = res.status ?? (res.ok ? 200 : 500);
  // redirect() throws, so it must stay outside any try/catch.
  if (status === 401 && redirectOn401 && ctx.token && !isDemoMode()) redirect(SESSION_EXPIRED_PATH);

  let payload: unknown = null;
  if (status !== 204) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }
  if (!res.ok) return { ok: false, status, error: extractErrorMessage(payload, status) };
  return { ok: true, status, data: payload as T };
}

/** GET helper: parsed body, or null on any failure. */
async function getJson<T>(path: string): Promise<T | null> {
  const result = await apiRequest<T>(path);
  return result.ok ? result.data : null;
}

export interface ApiHealth {
  status: 'ok' | 'error';
  info?: Record<string, { status: string }>;
}

/** `GET /health` (unprefixed, public). */
export async function getApiHealth(): Promise<ApiHealth | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ session

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export interface Membership {
  organizationId: string;
  organizationName: string;
  slug: string;
  role: Role;
}
export interface Me {
  user: SessionUser;
  memberships: Membership[];
}

/** `GET /auth/me`. Null when signed out, in demo mode, or the API is down. */
export async function getMe(): Promise<Me | null> {
  if (isDemoMode()) return null;
  const ctx = await readRequestContext();
  if (!ctx.token) return null;
  // /auth/me is not tenant scoped; drop the org header so a stale org can't 403 it.
  return getJsonWith<Me>('/auth/me', { token: ctx.token });
}

async function getJsonWith<T>(path: string, context: RequestContext): Promise<T | null> {
  const result = await apiRequest<T>(path, { context });
  return result.ok ? result.data : null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}
export const getOrganizations = () => getJson<Organization[]>('/organizations');

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
}
/**
 * `GET /organizations/:id/members`. The member shape isn't pinned down in the
 * contract, so accept either flat (`{ userId, email, name, role }`) or nested
 * (`{ role, user: { id, email, name } }`) items.
 */
export function normalizeMember(raw: unknown): Member | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const user = (r.user && typeof r.user === 'object' ? r.user : {}) as Record<string, unknown>;
  const userId = (r.userId ?? user.id ?? r.id) as string | undefined;
  if (!userId) return null;
  return {
    userId,
    email: String(r.email ?? user.email ?? ''),
    name: String(r.name ?? user.name ?? ''),
    role: (r.role as Role) ?? 'MEMBER',
  };
}
export async function getMembers(organizationId: string): Promise<Member[] | null> {
  const raw = await getJson<unknown[]>(`/organizations/${organizationId}/members`);
  if (!Array.isArray(raw)) return null;
  return raw.map(normalizeMember).filter((m): m is Member => m !== null);
}

// ----------------------------------------------------------------- projects

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
export const getProjects = () => getJson<Project[]>('/projects');

export interface DashboardSummary {
  activeInvestigations: number;
  totalInvestigations: number;
  dataSources: number;
  connectedDataSources: number;
  projects: number;
  unreadNotifications: number;
}
/** `GET /dashboard/summary`. Null in demo mode (no such endpoint there). */
export const getDashboardSummary = () => getJson<DashboardSummary>('/dashboard/summary');

// ------------------------------------------------------------ investigations

/**
 * Lists investigations from `GET /api/v1/investigations` (newest first).
 * Returns `[]` when the API is unreachable so pages can render an empty state.
 */
export async function getInvestigations(): Promise<Investigation[]> {
  const list = await getJson<Investigation[]>('/investigations');
  return Array.isArray(list) ? list : [];
}

export interface EvidenceItem {
  id: string;
  sourceType: string;
  summary: string;
  confidence: number | null;
  data: unknown;
}
export interface InvestigationFinding {
  id?: string;
  agentType: string;
  analyticsType: string;
  statement: string;
  confidence: number;
  isRootCause: boolean;
  /** Evidence summaries (always present, also in demo mode). */
  evidence: string[];
  evidenceItems?: EvidenceItem[];
}
export interface InvestigationRecommendation {
  id?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title?: string;
  /** Same as title; demo fixtures only carry `action`. */
  action?: string;
  description?: string | null;
  expectedImpact: string | null;
}
export interface InvestigationStepRecord {
  id: string;
  order: number;
  agentType: string;
  objective: string;
  dependsOn: number[];
}
export interface InvestigationTask {
  id: string;
  agentType: string;
  status: string;
  objective: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  investigationStepId: string | null;
}
export interface InvestigationEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}
/** Detail shape of `GET /investigations/:id`; trail fields are optional for demo compat. */
export type InvestigationDetail = Investigation & {
  steps?: InvestigationStepRecord[];
  tasks?: InvestigationTask[];
  findings?: InvestigationFinding[];
  recommendations?: InvestigationRecommendation[];
  events?: InvestigationEvent[];
  /** Phase 8: set on monitor-opened (ANOMALY_DETECTED) investigations. */
  triggerContext?: TriggerContext | null;
  monitorId?: string | null;
  monitor?: { id: string; name: string } | null;
  meta?: RunMeta | null;
};

/** `Investigation.triggerContext` written by the monitor cycle (spec section 8). */
export interface TriggerContext {
  monitorId?: string;
  metricKey?: string;
  metricName?: string;
  date?: string;
  direction?: string;
  severity?: string;
  value?: number;
  expectedValue?: number;
  deviationScore?: number;
  dataSourceId?: string;
  table?: string;
  [key: string]: unknown;
}

/** Coordinator run metadata (`result.meta`). */
export interface RunMeta {
  planner?: string;
  summaryWriter?: string;
  llmModel?: string;
  llmCalls?: number;
  llmErrors?: string[];
  [key: string]: unknown;
}

/**
 * Fetches one investigation. Falls back to filtering the list if the detail
 * endpoint fails. Returns `null` when not found or the API is unreachable.
 */
export async function getInvestigation(id: string): Promise<InvestigationDetail | null> {
  const detail = await apiRequest<InvestigationDetail>(`/investigations/${encodeURIComponent(id)}`);
  if (detail.ok && detail.data) return detail.data;

  const all = await getInvestigations();
  return all.find((investigation) => investigation.id === id) ?? null;
}

// ------------------------------------------------------------- data sources

export type DataSourceStatus = 'CONNECTED' | 'ERROR' | 'PENDING' | 'DISABLED';
export interface DataSourceSummary {
  /** Absent on demo fixtures. */
  id?: string;
  name: string;
  type: string;
  status: DataSourceStatus;
  statusMessage?: string | null;
  tables: number;
  lastSyncedAt: string | null;
  createdAt?: string;
}
export interface DiscoveredColumn {
  name: string;
  type: string;
  nullable: boolean;
  semanticType?: string | null;
}
export interface DiscoveredTable {
  tableName: string;
  columns: DiscoveredColumn[];
  rowCountEstimate: number | null;
  discoveredAt?: string;
}
export type DataSourceDetail = DataSourceSummary & { id: string; schemas: DiscoveredTable[] };
export interface TablePreview {
  columns: string[];
  rows: Record<string, unknown>[];
}
export interface TableProfile {
  table: string;
  rowCount: number;
  columns: { name: string; type: string; nullRate: number; distinctCount: number; semanticType: string }[];
}

export const getDataSources = () => getJson<DataSourceSummary[]>('/data-sources');
export const getDataSource = (id: string) =>
  apiRequest<DataSourceDetail>(`/data-sources/${encodeURIComponent(id)}`);
export const getDataSourcePreview = (id: string, table: string, limit = 50) =>
  apiRequest<TablePreview>(
    `/data-sources/${encodeURIComponent(id)}/preview?table=${encodeURIComponent(table)}&limit=${limit}`,
  );
export const getDataSourceProfile = (id: string, table: string) =>
  apiRequest<TableProfile>(
    `/data-sources/${encodeURIComponent(id)}/profile?table=${encodeURIComponent(table)}`,
  );

// ------------------------------------------------------------------ analytics
// Served by the API's analytics module (computed by the analytics engine
// over the org's first orders-like table, cached 60s) or by the demo module
// when HELIX_DEMO=1. Each helper returns null when unavailable (404 when no
// usable data source) so sections can render an empty state.

/** The table the analytics endpoints were computed from. */
export interface AnalyticsSourceRef {
  dataSourceId: string;
  dataSourceName: string;
  table: string;
  timeColumn: string;
  valueColumn: string;
  /** Last day of the data (YYYY-MM-DD): every window is anchored here. */
  seriesEnd: string;
}
/** One slice (e.g. channel = web) of the anomaly day's change vs expected. */
export interface StorySlice {
  value: string;
  actual: number;
  expected: number;
  delta: number;
  /** Percent, e.g. -82.9. */
  deltaPercent: number | null;
  /** Fraction of the total change this slice explains (can exceed 1). */
  shareOfDelta: number;
}
/** The worst revenue anomaly day, split by its most concentrated dimension. */
export interface RevenueStory {
  date: string;
  weekday: string;
  direction: 'spike' | 'drop';
  severity: Severity;
  zScore: number;
  actual: number;
  expected: number;
  delta: number;
  /** Percent, e.g. -38.8. */
  deltaPercent: number | null;
  dimension: string | null;
  slices: StorySlice[];
  topSlice: (StorySlice & { column: string }) | null;
  baselineMethod: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: 'currency' | 'percent' | 'count' | 'minutes';
  delta: number;
  spark: number[];
  previous?: number | null;
  sparkDays?: string[];
}
export interface Overview {
  generatedAt: string;
  kpis: Kpi[];
  source?: AnalyticsSourceRef;
  window?: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
}
export interface RevenuePoint {
  date: string;
  revenue: number;
  forecast: number;
  lower: number;
  upper: number;
  isAnomaly: boolean;
  zScore?: number | null;
}
export interface RevenueData {
  series: RevenuePoint[];
  bySegment: { segment: string; current: number; previous: number }[];
  channelMix: { channel: string; share: number }[];
  /** How forecast/lower/upper were computed (a fitted band, not a backtest). */
  bandMethod?: string;
  detectionMethod?: string;
  /** Forward forecast after the last day. */
  projection?: { date: string; value: number; lower: number; upper: number }[];
  projectionMethod?: string;
  projectionMape?: number | null;
  /** Column bySegment/channelMix/channelSeries are split by. */
  segmentColumn?: string | null;
  channelSeries?: { channel: string; points: { date: string; value: number }[] }[];
  story?: RevenueStory | null;
  source?: AnalyticsSourceRef;
}
export type Severity = 'critical' | 'serious' | 'warning';
export interface Anomaly {
  id: string;
  metric: string;
  severity: Severity;
  zScore: number;
  change: number;
  detectedAt: string;
  segment: string;
  date?: string;
  metricKey?: string;
  value?: number;
  expectedValue?: number;
  direction?: 'spike' | 'drop';
  description?: string;
}
export interface AnomalyData {
  items: Anomaly[];
  heatmap: { metrics: string[]; days: string[]; cells: number[][]; metricKeys?: string[] };
  /** |z| at or above this is flagged. */
  threshold?: number;
  source?: AnalyticsSourceRef;
}
export interface ThroughputDay {
  date: string;
  anomaly: number;
  question: number;
  scheduled: number;
}
export interface AgentContextRequirements {
  semanticTypes?: string[];
  tableKeywords?: string[];
  dataSourceTypes?: string[] | null;
  includeHistory?: boolean;
  historyDays?: number;
  includeUpstream?: boolean;
  maxTokens?: number;
}
export interface AgentSummary {
  type: string;
  name: string;
  status: 'BUSY' | 'IDLE' | 'UNAVAILABLE';
  tasks: number;
  successRate: number | null;
  avgMs: number | null;
  description?: string | null;
  version?: string | null;
  capabilities?: { name: string; description: string }[];
  /** Passed through from the agent runtime when it provides it (Phase 6). */
  contextRequirements?: AgentContextRequirements | null;
}

export const getOverview = () => getJson<Overview>('/analytics/overview');
export const getRevenue = () => getJson<RevenueData>('/analytics/revenue');
export const getAnomalies = () => getJson<AnomalyData>('/analytics/anomalies');
export const getThroughput = () => getJson<ThroughputDay[]>('/analytics/throughput');
export const getAgents = () => getJson<AgentSummary[]>('/agents');

// ------------------------------------------------------------ notifications

export interface AppNotification {
  id: string;
  userId?: string;
  organizationId: string | null;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** `GET /notifications` (newest first, max 100). Null when unavailable. */
export async function getNotifications(unreadOnly = false): Promise<AppNotification[] | null> {
  if (isDemoMode()) return null;
  const list = await getJson<AppNotification[]>(`/notifications${unreadOnly ? '?unread=true' : ''}`);
  return Array.isArray(list) ? list : null;
}

/**
 * Unread notification count for the bell. Uses `GET /notifications/unread-count`
 * and falls back to the dashboard summary. Null in demo mode or when unknown.
 */
export async function getUnreadNotificationCount(): Promise<number | null> {
  if (isDemoMode()) return null;
  const ctx = await readRequestContext();
  if (!ctx.token) return null;
  const res = await apiRequest<{ count: number }>('/notifications/unread-count', { redirectOn401: false });
  if (res.ok && typeof res.data?.count === 'number') return res.data.count;
  const summary = await apiRequest<DashboardSummary>('/dashboard/summary', { redirectOn401: false });
  return summary.ok && typeof summary.data?.unreadNotifications === 'number' ? summary.data.unreadNotifications : null;
}

// ---------------------------------------------------------------- monitoring

export type AnomalySeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type MonitorAggregation = 'sum' | 'mean' | 'count' | 'count_distinct';

export interface Monitor {
  id: string;
  name: string;
  projectId: string;
  dataSourceId: string;
  dataSource?: { id: string; name: string } | null;
  metricKey: string;
  tableName: string;
  timeColumn: string;
  valueColumn: string | null;
  aggregation: MonitorAggregation | string;
  filter?: unknown;
  unit?: string | null;
  minSeverity: AnomalySeverityLevel;
  lookbackDays: number;
  cooldownHours: number;
  enabled: boolean;
  lastRunAt: string | null;
  /** ok | anomaly | investigation_opened | deduped | rate_limited | error */
  lastStatus: string | null;
  lastMessage: string | null;
  investigationsCount?: number;
  latestInvestigation?: { id: string; status: string; createdAt: string } | null;
  createdAt?: string;
}

export interface MonitorSuggestion {
  name: string;
  metricKey: string;
  dataSourceId: string;
  dataSourceName: string;
  tableName: string;
  timeColumn: string;
  valueColumn: string | null;
  aggregation: MonitorAggregation | string;
  filter: unknown;
  unit: string | null;
}

export interface MonitorRunResult {
  monitorId?: string;
  monitorName?: string;
  status: string;
  message: string;
  investigationId?: string | null;
  anomaly?: Record<string, unknown> | null;
}

/** One row of `GET /anomalies` (persisted Anomaly rows, newest first). */
export interface AnomalyRecord {
  id: string;
  description: string;
  severity: AnomalySeverityLevel | string;
  detectedAt: string;
  detectionMethod?: string;
  value: number;
  expectedValue: number | null;
  deviationScore: number | null;
  dataSourceId?: string | null;
  metricId?: string | null;
  metricName?: string | null;
  metric?: { id: string; name: string; unit?: string | null } | null;
  investigationId?: string | null;
  unit?: string | null;
  dataSource?: { id: string; name: string } | null;
  createdAt?: string;
}

export async function getMonitors(): Promise<Monitor[] | null> {
  if (isDemoMode()) return null;
  const list = await getJson<Monitor[]>('/monitors');
  return Array.isArray(list) ? list : null;
}
export async function getMonitorSuggestions(): Promise<MonitorSuggestion[] | null> {
  if (isDemoMode()) return null;
  const list = await getJson<MonitorSuggestion[]>('/monitors/suggestions');
  return Array.isArray(list) ? list : null;
}
export async function getRecentAnomalies(limit = 50): Promise<AnomalyRecord[] | null> {
  if (isDemoMode()) return null;
  const list = await getJson<AnomalyRecord[]>(`/anomalies?limit=${limit}`);
  return Array.isArray(list) ? list : null;
}

/** An anomaly as the monitor engine reports it (run results and `/monitors/:id/series`). */
export interface MonitorAnomaly {
  /** YYYY-MM-DD (UTC). */
  date: string;
  timestamp: string;
  direction: 'drop' | 'spike' | string;
  severity: AnomalySeverityLevel | string;
  value: number;
  expectedValue: number;
  deviationScore: number;
  detectionMethod: string;
  description: string;
}

/** `GET /monitors/:id/series`: the watched daily series with every detected anomaly. */
export interface MonitorSeries {
  monitorId: string;
  monitorName: string;
  unit: string | null;
  lookbackDays: number;
  minSeverity: AnomalySeverityLevel | string;
  methodUsed: string | null;
  seriesEnd: string | null;
  series: { date: string; value: number | null }[];
  anomalies: MonitorAnomaly[];
  /** The anomaly a run would act on now, or null. */
  picked: MonitorAnomaly | null;
}

export async function getMonitorSeries(id: string): Promise<MonitorSeries | null> {
  if (isDemoMode()) return null;
  const data = await getJson<MonitorSeries>(`/monitors/${encodeURIComponent(id)}/series`);
  return data && Array.isArray(data.series) ? data : null;
}

// ------------------------------------------------------------------- trace

export type TraceGraphNodeType =
  | 'question'
  | 'step'
  | 'task'
  | 'evidence'
  | 'finding'
  | 'rootCause'
  | 'recommendation';
export type TraceGraphEdgeKind = 'plans' | 'runs' | 'collected' | 'supports' | 'justifies' | 'selected';

export interface TraceGraphNode {
  id: string;
  type: TraceGraphNodeType;
  label: string;
  agentType?: string;
  confidence?: number | null;
}
export interface TraceGraphEdge {
  from: string;
  to: string;
  kind: TraceGraphEdgeKind;
}
export interface TraceStep {
  id: string;
  order: number;
  agentType: string;
  objective: string;
  dependsOn: number[];
}
export interface TraceTask {
  id: string;
  stepId: string | null;
  agentType: string;
  status: string;
  objective: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  contextSnapshotId: string | null;
  findingIds: string[];
  evidenceIds: string[];
  /** The task's raw result JSON as returned by the agent. */
  result?: unknown;
}
export interface TraceMessage {
  id: string;
  type: string;
  agentTaskId: string | null;
  fromAgent: string;
  toAgent: string;
  payload: Record<string, unknown> | null;
  correlationId: string | null;
  createdAt: string;
}
export interface TraceContextSnapshot {
  id: string;
  agentTaskId: string | null;
  agentType: string;
  tokenCount: number | null;
  createdAt: string;
  assembledContext: unknown;
}
export interface TraceEvidence {
  id: string;
  agentTaskId: string | null;
  sourceType: string;
  /** Free-form JSON (often a string or `{ engine, endpoint }`). */
  source?: unknown;
  summary: string;
  data: unknown;
  confidence: number | null;
  collectedAt?: string | null;
}
export interface TraceFinding {
  id: string;
  agentType: string;
  analyticsType: string;
  statement: string;
  confidence: number;
  isRootCause: boolean;
  evidenceIds: string[];
  agentTaskId?: string | null;
}
export interface TraceRecommendation {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  expectedImpact: string | null;
  findingIds: string[];
}
export interface InvestigationTrace {
  investigation: {
    id: string;
    question: string;
    status: string;
    triggerType: string;
    triggerContext: TriggerContext | null;
    summary: string | null;
    overallConfidence: number | null;
    rootCauseFindingId: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    monitor?: { id: string; name: string } | null;
  };
  plan: { steps?: unknown[]; reasoning?: string } | null;
  meta: RunMeta | null;
  steps: TraceStep[];
  tasks: TraceTask[];
  messages: TraceMessage[];
  contextSnapshots: TraceContextSnapshot[];
  events: InvestigationEvent[];
  evidence: TraceEvidence[];
  findings: TraceFinding[];
  recommendations: TraceRecommendation[];
  graph: { nodes: TraceGraphNode[]; edges: TraceGraphEdge[] } | null;
}

/** `GET /investigations/:id/trace`. Null when unavailable (older API, demo mode). */
export async function getInvestigationTrace(id: string): Promise<InvestigationTrace | null> {
  if (isDemoMode()) return null;
  const trace = await getJson<InvestigationTrace>(`/investigations/${encodeURIComponent(id)}/trace`);
  return trace && typeof trace === 'object' && trace.investigation ? trace : null;
}
