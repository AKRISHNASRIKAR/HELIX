import type { Investigation } from '@helix/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiHealth {
  status: 'ok' | 'error';
  info?: Record<string, { status: string }>;
}

/** Server-side fetch helper for the API — no client secrets, no business logic here. */
export async function getApiHealth(): Promise<ApiHealth | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}

/**
 * Lists investigations from `GET /api/v1/investigations` (the one real endpoint
 * today — read-only, org scoping arrives in Phase 1). Returns `[]` when the API
 * is unreachable so pages can render a graceful empty state instead of erroring.
 */
export async function getInvestigations(): Promise<Investigation[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/investigations`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as Investigation[];
  } catch {
    return [];
  }
}

/**
 * Fetches one investigation. There is no `GET /investigations/:id` endpoint yet
 * (Phase 1), so this falls back to filtering the list. Returns `null` when not
 * found or the API is unreachable.
 */
export interface InvestigationFinding {
  agentType: string;
  analyticsType: string;
  statement: string;
  confidence: number;
  isRootCause: boolean;
  evidence: string[];
}
export interface InvestigationRecommendation {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  action: string;
  expectedImpact: string;
}
/** Findings/recommendations are only present in demo mode until Phase 5. */
export type InvestigationDetail = Investigation & {
  findings?: InvestigationFinding[];
  recommendations?: InvestigationRecommendation[];
};

export async function getInvestigation(id: string): Promise<InvestigationDetail | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/investigations/${id}`, { cache: 'no-store' });
    if (res.ok) return (await res.json()) as InvestigationDetail;
  } catch {
    // fall through to the list-based lookup below
  }

  const all = await getInvestigations();
  return all.find((investigation) => investigation.id === id) ?? null;
}

// ------------------------------------------------------------------ analytics
// Served by the API's demo module (HELIX_DEMO=1) until the analytics engine
// lands in Phase 3. Each helper returns null when unavailable so sections can
// render an empty state.

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: 'currency' | 'percent' | 'count' | 'minutes';
  delta: number;
  spark: number[];
}
export interface Overview {
  generatedAt: string;
  kpis: Kpi[];
}
export interface RevenuePoint {
  date: string;
  revenue: number;
  forecast: number;
  lower: number;
  upper: number;
  isAnomaly: boolean;
}
export interface RevenueData {
  series: RevenuePoint[];
  bySegment: { segment: string; current: number; previous: number }[];
  channelMix: { channel: string; share: number }[];
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
}
export interface AnomalyData {
  items: Anomaly[];
  heatmap: { metrics: string[]; days: string[]; cells: number[][] };
}
export interface ThroughputDay {
  date: string;
  anomaly: number;
  question: number;
  scheduled: number;
}
export interface AgentSummary {
  type: string;
  name: string;
  status: 'BUSY' | 'IDLE' | 'UNAVAILABLE';
  tasks: number;
  successRate: number;
  avgMs: number;
}
export interface DataSourceSummary {
  name: string;
  type: string;
  status: 'CONNECTED' | 'ERROR' | 'PENDING' | 'DISABLED';
  tables: number;
  lastSyncedAt: string;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getOverview = () => getJson<Overview>('/analytics/overview');
export const getRevenue = () => getJson<RevenueData>('/analytics/revenue');
export const getAnomalies = () => getJson<AnomalyData>('/analytics/anomalies');
export const getThroughput = () => getJson<ThroughputDay[]>('/analytics/throughput');
export const getAgents = () => getJson<AgentSummary[]>('/agents');
export const getDataSources = () => getJson<DataSourceSummary[]>('/data-sources');
