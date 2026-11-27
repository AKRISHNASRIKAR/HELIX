import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../config/env';
import { requestJson } from './http';

/** The analytics engine's FilterSpec (services/analytics-engine/app/models.py). */
export interface EngineFilter {
  column: string;
  op: 'eq' | 'neq' | 'in';
  value: unknown;
}

/** `POST /anomalies/detect` body, loading rows through ingestion by data source. */
export interface DetectAnomaliesRequest {
  dataset: { dataSourceId: string; organizationId: string; table: string };
  timeColumn: string;
  valueColumn?: string | null;
  aggregation: string;
  filter?: EngineFilter | null;
  method: 'auto' | 'zscore' | 'iqr' | 'seasonal';
  metricName?: string;
  unit?: string | null;
}

export interface EngineAnomaly {
  timestamp: string;
  value: number;
  expectedValue: number;
  deviationScore: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  direction: 'spike' | 'drop';
  detectionMethod: string;
  description: string;
}

export interface DetectAnomaliesResponse {
  metric: {
    name: string;
    unit: string | null;
    value: number | null;
    series: { timestamp: string; value: number | null }[];
    computationMethod: string;
  };
  methodUsed: string;
  anomalies: EngineAnomaly[];
  computationMethod: string;
}

/** Dataset reference loaded through ingestion by data source. */
export interface EngineDataset {
  dataSourceId: string;
  organizationId: string;
  table: string;
}

/** `POST /anomalies/detect` optional detection threshold (default 3). */
export interface DetectAnomaliesRequestWithThreshold extends DetectAnomaliesRequest {
  threshold?: number;
}

export interface EngineAggSpec {
  aggregation: 'sum' | 'mean' | 'count' | 'count_distinct';
  column?: string | null;
  filter?: EngineFilter | null;
}

export interface EngineKpiSpec {
  name: string;
  aggregation: 'sum' | 'mean' | 'count' | 'count_distinct' | 'ratio';
  column?: string | null;
  filter?: EngineFilter | null;
  unit?: string | null;
  numerator?: EngineAggSpec | null;
  denominator?: EngineAggSpec | null;
}

/** `POST /kpis` body. */
export interface KpiRequest {
  dataset: EngineDataset;
  timeColumn: string;
  kpis: EngineKpiSpec[];
  windowDays?: number;
  asOf?: string | null;
}

export interface EngineKpiMetric {
  name: string;
  unit: string | null;
  value: number | null;
  baseline: number | null;
  /** Percent, e.g. -12.5 for a 12.5% drop. */
  changePercent: number | null;
  series: { timestamp: string; value: number | null }[];
  computationMethod: string;
  pValue: number | null;
  window: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
}

export interface KpiResponse {
  metrics: EngineKpiMetric[];
}

/** `POST /forecast` body. */
export interface ForecastRequest {
  dataset: EngineDataset;
  timeColumn: string;
  valueColumn?: string | null;
  aggregation: string;
  filter?: EngineFilter | null;
  horizon?: number;
  method?: 'auto' | 'ets' | 'arima';
}

export interface ForecastResponse {
  history: { timestamp: string; value: number | null }[];
  forecast: { timestamp: string; value: number; lower: number; upper: number }[];
  methodUsed: string;
  backtest: { mape: number | null; holdoutDays: number };
  computationMethod: string;
}

/** `POST /segments/compare` body. */
export interface SegmentCompareRequest {
  dataset: EngineDataset;
  timeColumn: string;
  valueColumn?: string | null;
  aggregation: string;
  filter?: EngineFilter | null;
  dimensions?: string[] | null;
  targetDate: string;
  baseline?: 'same_weekday' | 'trailing_mean';
  baselinePeriods?: number;
  metricName?: string;
}

export interface EngineChange {
  actual: number;
  expected: number;
  delta: number;
  deltaPercent: number | null;
}

export interface EngineSlice extends EngineChange {
  value: string;
  shareOfDelta: number;
}

export interface SegmentCompareResponse {
  targetDate: string;
  metricName: string;
  unit: string | null;
  aggregation: string;
  total: EngineChange;
  dimensions: { column: string; concentration: number; slices: EngineSlice[] }[];
  topSlice: (EngineSlice & { column: string }) | null;
  computationMethod: string;
}

/**
 * HTTP client for services/analytics-engine. The API calls it directly for
 * monitors (Phase 9) and dashboard analytics; investigations reach it
 * through the agents.
 * Injectable so tests can mock it.
 */
@Injectable()
export class AnalyticsEngineClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.baseUrl = config.get('ANALYTICS_ENGINE_URL', { infer: true }).replace(/\/$/, '');
    this.token = config.get('HELIX_INTERNAL_TOKEN', { infer: true });
  }

  detectAnomalies(body: DetectAnomaliesRequest): Promise<DetectAnomaliesResponse> {
    return requestJson(`${this.baseUrl}/anomalies/detect`, body, {
      timeoutMs: 60_000,
      token: this.token,
    });
  }

  /** Dashboard analytics: KPI windows (current vs previous). */
  kpis(body: KpiRequest): Promise<KpiResponse> {
    return requestJson(`${this.baseUrl}/kpis`, body, { timeoutMs: 60_000, token: this.token });
  }

  /** Dashboard analytics: forward forecast with prediction interval. */
  forecast(body: ForecastRequest): Promise<ForecastResponse> {
    return requestJson(`${this.baseUrl}/forecast`, body, { timeoutMs: 60_000, token: this.token });
  }

  /** Dashboard analytics: which slices drove a day's change vs its baseline. */
  compareSegments(body: SegmentCompareRequest): Promise<SegmentCompareResponse> {
    return requestJson(`${this.baseUrl}/segments/compare`, body, {
      timeoutMs: 60_000,
      token: this.token,
    });
  }
}
