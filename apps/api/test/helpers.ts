import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AgentRuntimeClient } from '../src/clients/agent-runtime.client';
import { IngestionClient } from '../src/clients/ingestion.client';

export const API = '/api/v1';

/** Mocked outbound clients; tests set per-case behaviour with mockResolvedValue etc. */
export function mockClients() {
  return {
    ingestion: { connect: jest.fn(), preview: jest.fn(), profile: jest.fn() },
    agentRuntime: { listAgents: jest.fn(), runInvestigation: jest.fn() },
  };
}
export type MockClients = ReturnType<typeof mockClients>;

export async function createApp(mocks: MockClients): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IngestionClient)
    .useValue(mocks.ingestion)
    .overrideProvider(AgentRuntimeClient)
    .useValue(mocks.agentRuntime)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export async function signup(app: INestApplication, label = 'user'): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@e2e.helix.test`;
  const res = await request(app.getHttpServer())
    .post(`${API}/auth/signup`)
    .send({ email, name: label, password: 'correct-horse-battery' })
    .expect(201);
  return { id: res.body.user.id, email, token: res.body.accessToken };
}

export async function createOrg(
  app: INestApplication,
  user: TestUser,
  name = 'Acme',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`${API}/organizations`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name })
    .expect(201);
  return res.body.id;
}

/** Authenticated, tenant-scoped supertest helpers. */
export function as(app: INestApplication, user: TestUser, orgId?: string) {
  const server = app.getHttpServer();
  const wrap = (req: request.Test) => {
    req.set('Authorization', `Bearer ${user.token}`);
    if (orgId) req.set('X-Organization-Id', orgId);
    return req;
  };
  return {
    get: (path: string) => wrap(request(server).get(`${API}${path}`)),
    post: (path: string) => wrap(request(server).post(`${API}${path}`)),
    patch: (path: string) => wrap(request(server).patch(`${API}${path}`)),
    delete: (path: string) => wrap(request(server).delete(`${API}${path}`)),
  };
}

export const ORDERS_SCHEMA = {
  tableName: 'orders',
  columns: [
    { name: 'created_at', type: 'timestamp', nullable: false, semanticType: 'datetime' },
    { name: 'amount', type: 'float', nullable: false, semanticType: 'currency' },
    { name: 'channel', type: 'text', nullable: false, semanticType: 'categorical' },
  ],
  rowCountEstimate: 25000,
};

/** A complete, valid InvestigationRunResult (spec D) with fresh ids. */
export function buildRunResult(opts: { dataSourceId?: string; status?: string } = {}) {
  const stepId = randomUUID();
  const taskId = randomUUID();
  const metricId = randomUUID();
  const anomalyId = randomUUID();
  const evidenceId = randomUUID();
  const findingId = randomUUID();
  const now = new Date().toISOString();
  return {
    status: opts.status ?? 'COMPLETED',
    plan: {
      steps: [
        {
          order: 0,
          agentType: 'ANALYTICS',
          objective: 'Find what drove the revenue drop',
          dependsOn: [],
        },
      ],
      reasoning: 'Single analytics step for a revenue question.',
    },
    steps: [
      {
        id: stepId,
        order: 0,
        agentType: 'ANALYTICS',
        objective: 'Find what drove the revenue drop',
        dependsOn: [],
      },
    ],
    tasks: [
      {
        id: taskId,
        stepId,
        agentType: 'ANALYTICS',
        status: 'SUCCEEDED',
        objective: 'Find what drove the revenue drop',
        inputContext: { table: 'orders' },
        result: { findings: 1 },
        error: null,
        startedAt: now,
        completedAt: now,
        timeoutMs: 60000,
      },
    ],
    evidence: [
      {
        id: evidenceId,
        agentTaskId: taskId,
        sourceType: 'ANOMALY',
        source: {
          dataSourceId: opts.dataSourceId,
          agentTaskId: taskId,
          description: 'Robust z-score on daily revenue',
        },
        summary: 'Revenue on 2026-10-08 was 41% below expected',
        data: { metricId, anomalyId },
        confidence: 0.92,
        collectedAt: now,
      },
    ],
    findings: [
      {
        id: findingId,
        agentTaskId: taskId,
        agentType: 'ANALYTICS',
        analyticsType: 'DIAGNOSTIC',
        statement: 'Revenue dropped 41% on 2026-10-08, concentrated in the web channel',
        confidence: 0.9,
        isRootCause: true,
        evidenceIds: [evidenceId],
      },
    ],
    recommendations: [
      {
        id: randomUUID(),
        title: 'Audit the web checkout release of 2026-10-07',
        description: 'The drop is isolated to web orders.',
        priority: 'HIGH',
        expectedImpact: 'Recover ~40% of daily web revenue',
        findingIds: [findingId],
      },
    ],
    metrics: [
      {
        id: metricId,
        dataSourceId: opts.dataSourceId ?? null,
        name: 'revenue',
        unit: 'USD',
        value: 105000,
        baseline: 178000,
        changePercent: -41,
        series: [{ timestamp: '2026-10-08T00:00:00Z', value: 105000 }],
        computationMethod: 'Daily sum of amount (UTC days)',
        computedAt: now,
      },
    ],
    anomalies: [
      {
        id: anomalyId,
        metricId,
        dataSourceId: opts.dataSourceId ?? null,
        description: 'Revenue drop on 2026-10-08',
        severity: 'HIGH',
        detectedAt: '2026-10-08T00:00:00Z',
        detectionMethod: 'robust_zscore',
        value: 105000,
        expectedValue: 178000,
        deviationScore: -5.2,
      },
    ],
    summary: 'Revenue fell 41% on 2026-10-08 because web channel orders collapsed.',
    overallConfidence: 0.9,
    rootCauseFindingId: findingId,
  };
}
