import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../config/env';
import { requestJson } from './http';

export interface RuntimeAgent {
  type: string;
  name: string;
  description?: string;
  version?: string;
  status: 'IDLE' | 'BUSY' | 'UNAVAILABLE';
  capabilities: { name: string; description: string }[];
}

/** Spec D `POST /investigations/run` request body. */
export interface RunInvestigationRequest {
  investigation: {
    id: string;
    organizationId: string;
    projectId: string;
    question: string;
    triggerType: string;
  };
  dataSources: {
    id: string;
    name: string;
    type: string;
    schemas: {
      tableName: string;
      columns: { name: string; type: string; nullable: boolean; semanticType?: string }[];
      rowCountEstimate: number | null;
    }[];
  }[];
}

export const RUN_TIMEOUT_MS = 120_000;

/** HTTP client for services/agent-runtime. Injectable so tests can mock it. */
@Injectable()
export class AgentRuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.baseUrl = config.get('AGENT_RUNTIME_URL', { infer: true }).replace(/\/$/, '');
    this.token = config.get('HELIX_INTERNAL_TOKEN', { infer: true });
  }

  listAgents(): Promise<RuntimeAgent[]> {
    return requestJson(`${this.baseUrl}/agents`, undefined, {
      method: 'GET',
      timeoutMs: 5_000,
      token: this.token,
    });
  }

  /** Returns the raw InvestigationRunResult; the runner validates it. */
  runInvestigation(body: RunInvestigationRequest): Promise<unknown> {
    return requestJson(`${this.baseUrl}/investigations/run`, body, {
      timeoutMs: RUN_TIMEOUT_MS,
      token: this.token,
    });
  }
}
