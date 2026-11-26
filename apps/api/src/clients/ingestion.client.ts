import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../config/env';
import { requestJson } from './http';

/** Spec B ConnectionSpec: everything the ingestion service needs to reach a source. */
export interface ConnectionSpec {
  type: 'POSTGRESQL' | 'CSV' | 'MCP' | 'GITHUB';
  config: Record<string, unknown>;
  credentials?: Record<string, unknown> | null;
  filePath?: string | null;
}

export interface DiscoveredColumn {
  name: string;
  type: string;
  nullable: boolean;
  semanticType?: string;
}

export interface DiscoveredTable {
  tableName: string;
  columns: DiscoveredColumn[];
  rowCountEstimate: number | null;
}

export type ConnectResult = { ok: true; schemas: DiscoveredTable[] } | { ok: false; error: string };

export interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ProfileResult {
  table: string;
  rowCount: number;
  columns: {
    name: string;
    type: string;
    nullRate: number;
    distinctCount: number;
    semanticType: string;
  }[];
}

/**
 * HTTP client for services/ingestion-service. Throws UpstreamError on
 * network failure or non-2xx; callers decide how that maps to API errors.
 * Injectable so tests can swap it out.
 */
@Injectable()
export class IngestionClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.baseUrl = config.get('INGESTION_SERVICE_URL', { infer: true }).replace(/\/$/, '');
    this.token = config.get('HELIX_INTERNAL_TOKEN', { infer: true });
  }

  connect(connection: ConnectionSpec): Promise<ConnectResult> {
    return requestJson(
      `${this.baseUrl}/connect`,
      { connection },
      { timeoutMs: 30_000, token: this.token },
    );
  }

  preview(connection: ConnectionSpec, table: string, limit?: number): Promise<PreviewResult> {
    return requestJson(
      `${this.baseUrl}/preview`,
      { connection, table, limit },
      { timeoutMs: 30_000, token: this.token },
    );
  }

  profile(connection: ConnectionSpec, table: string, sampleSize?: number): Promise<ProfileResult> {
    return requestJson(
      `${this.baseUrl}/profile`,
      { connection, table, sampleSize },
      { timeoutMs: 60_000, token: this.token },
    );
  }
}
