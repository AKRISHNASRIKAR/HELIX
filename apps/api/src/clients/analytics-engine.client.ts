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

/**
 * HTTP client for services/analytics-engine. The API only calls it directly
 * for monitors (Phase 9); investigations reach it through the agents.
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
}
