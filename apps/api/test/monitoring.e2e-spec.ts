import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { MonitoringService } from '../src/monitors/monitoring.service';
import { InvestigationRunnerService } from '../src/runner/investigation-runner.service';
import {
  API,
  as,
  buildRunResult,
  createApp,
  createOrg,
  mockClients,
  signup,
  TestUser,
} from './helpers';

const ORDERS = {
  tableName: 'orders',
  columns: [
    { name: 'order_id', type: 'text', nullable: false, semanticType: 'identifier' },
    { name: 'created_at', type: 'timestamp', nullable: false, semanticType: 'datetime' },
    { name: 'customer_id', type: 'text', nullable: false, semanticType: 'identifier' },
    { name: 'channel', type: 'text', nullable: false, semanticType: 'categorical' },
    { name: 'amount', type: 'float', nullable: false, semanticType: 'currency' },
    { name: 'status', type: 'text', nullable: false, semanticType: 'categorical' },
  ],
  rowCountEstimate: 25000,
};
const DEPLOYMENTS = {
  tableName: 'deployments',
  columns: [
    { name: 'service', type: 'text', nullable: false, semanticType: 'categorical' },
    { name: 'deployed_at', type: 'timestamp', nullable: false, semanticType: 'datetime' },
  ],
  rowCountEstimate: 40,
};

/** Daily revenue 2026-07-17..2026-10-14 with a HIGH drop on 2026-10-08 (engine response shape). */
function detection() {
  return {
    metric: {
      name: 'Daily revenue',
      unit: 'USD',
      value: 1,
      baseline: null,
      changePercent: null,
      series: Array.from({ length: 90 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-07-17T00:00:00Z') + i * 86_400_000).toISOString(),
        value: 33000,
      })),
      computationMethod: 'daily sum',
      computedAt: '2026-11-27T00:00:00Z',
    },
    methodUsed: 'seasonal',
    computationMethod: 'seasonal decomposition',
    anomalies: [
      {
        timestamp: '2026-10-08T00:00:00+00:00',
        value: 19950,
        expectedValue: 33124,
        deviationScore: -6.1,
        severity: 'HIGH',
        direction: 'drop',
        detectionMethod: 'seasonal',
        description: 'Daily revenue dropped to 19950 vs expected 33124',
      },
    ],
  };
}

/** buildRunResult plus a Coordinator synthesis task, A2A messages and context snapshots. */
function multiAgentResult(dataSourceId: string) {
  const r = buildRunResult({ dataSourceId });
  const analyticsTask = r.tasks[0]!;
  const synthStep = randomUUID();
  const synthTask = randomUUID();
  const rankingEvidence = randomUUID();
  const rootId = randomUUID();
  const now = new Date().toISOString();
  r.findings[0]!.isRootCause = false;
  r.steps.push({
    id: synthStep,
    order: 1,
    agentType: 'COORDINATOR',
    objective: 'Synthesize findings into a root cause, recommendations and a summary',
    dependsOn: [0],
  });
  r.tasks.push({
    ...analyticsTask,
    id: synthTask,
    stepId: synthStep,
    agentType: 'COORDINATOR',
    objective: 'Synthesize',
    inputContext: {},
    result: { candidates: 1 },
  });
  r.evidence.push({
    id: rankingEvidence,
    agentTaskId: synthTask,
    sourceType: 'METRIC',
    source: { dataSourceId, agentTaskId: synthTask, description: 'helix_root_cause' },
    summary: 'Root cause ranking',
    data: { kind: 'root_cause_ranking' } as never,
    confidence: 0.91,
    collectedAt: now,
  });
  r.findings.push({
    id: rootId,
    agentTaskId: synthTask,
    agentType: 'COORDINATOR',
    analyticsType: 'DIAGNOSTIC',
    statement: 'Revenue dropped 39.8% on Thursday 2026-10-08 because web orders collapsed',
    confidence: 0.91,
    isRootCause: true,
    evidenceIds: [r.evidence[0]!.id, rankingEvidence],
  });
  r.rootCauseFindingId = rootId;
  return {
    ...r,
    messages: [
      {
        id: randomUUID(),
        type: 'TASK_REQUEST',
        agentTaskId: analyticsTask.id,
        fromAgent: 'COORDINATOR',
        toAgent: 'ANALYTICS',
        payload: { objective: analyticsTask.objective, transport: 'a2a-gateway' },
        correlationId: analyticsTask.id,
        createdAt: now,
      },
      {
        id: randomUUID(),
        type: 'TASK_RESULT',
        agentTaskId: analyticsTask.id,
        fromAgent: 'ANALYTICS',
        toAgent: 'COORDINATOR',
        payload: { status: 'SUCCEEDED', findings: 1 },
        correlationId: analyticsTask.id,
        createdAt: new Date(Date.parse(now) + 1000).toISOString(),
      },
    ],
    contextSnapshots: [
      {
        id: randomUUID(),
        agentTaskId: analyticsTask.id,
        agentType: 'ANALYTICS',
        assembledContext: { source: 'context-engine', focus: { anomalyDates: ['2026-10-08'] } },
        tokenCount: 512,
        createdAt: now,
      },
      {
        id: randomUUID(),
        agentTaskId: synthTask,
        agentType: 'COORDINATOR',
        assembledContext: { source: 'coordinator' },
        tokenCount: 128,
        createdAt: now,
      },
    ],
    meta: { planner: 'rules', summaryWriter: 'rules', llmCalls: 0, llmErrors: [] },
  };
}

/** Phases 6 to 10 API: data source types, monitors, autonomous runs, trace, internal context. */
describe('Monitoring and trace (e2e)', () => {
  const mocks = mockClients();
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: InvestigationRunnerService;
  let owner: TestUser;
  let member: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let projectId: string;
  let ordersId: string;
  let monitorId: string;
  let autonomousId: string;

  const internal = (path: string) =>
    request(app.getHttpServer())
      .get(`${API}/internal${path}`)
      .set('x-helix-internal-token', 'e2e-internal-token');

  beforeAll(async () => {
    app = await createApp(mocks);
    prisma = app.get(PrismaService);
    runner = app.get(InvestigationRunnerService);
    owner = await signup(app, 'mon-owner');
    member = await signup(app, 'mon-member');
    viewer = await signup(app, 'mon-viewer');
    orgId = await createOrg(app, owner, 'Monitor Co');
    for (const [u, role] of [
      [member, 'MEMBER'],
      [viewer, 'VIEWER'],
    ] as const) {
      await as(app, owner)
        .post(`/organizations/${orgId}/members`)
        .send({ email: u.email, role })
        .expect(201);
    }
    const api = as(app, owner, orgId);
    projectId = (await api.post('/projects').send({ name: 'Revenue' }).expect(201)).body.id;
    mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS] });
    ordersId = (
      await api
        .post('/data-sources')
        .send({
          name: 'orders',
          config: { host: 'h', database: 'd' },
          credentials: { user: 'u', password: 'p' },
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await runner.whenIdle();
    await app.close();
  });

  describe('data source types', () => {
    it('creates an MCP source, encrypting the token, and resolves its connection', async () => {
      const api = as(app, owner, orgId);
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [DEPLOYMENTS] });
      const res = await api
        .post('/data-sources')
        .send({
          name: 'deploys',
          type: 'MCP',
          config: { serverUrl: 'http://localhost:8006/mcp' },
          credentials: { token: 'mcp-secret' },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        type: 'MCP',
        status: 'CONNECTED',
        config: { serverUrl: 'http://localhost:8006/mcp', transport: 'streamable_http' },
      });
      expect(JSON.stringify(res.body)).not.toContain('mcp-secret');
      expect(mocks.ingestion.connect.mock.calls.at(-1)[0]).toEqual({
        type: 'MCP',
        config: { serverUrl: 'http://localhost:8006/mcp', transport: 'streamable_http' },
        credentials: { token: 'mcp-secret' },
        filePath: null,
      });
      const cred = await prisma.dataSourceCredential.findUniqueOrThrow({
        where: { dataSourceId: res.body.id },
      });
      expect(cred.ciphertext).not.toContain('mcp-secret');

      const conn = await internal(
        `/data-sources/${res.body.id}/connection?organizationId=${orgId}`,
      ).expect(200);
      expect(conn.body).toMatchObject({ type: 'MCP', credentials: { token: 'mcp-secret' } });

      // PATCH validates the merged config for the type and reconnects.
      await api
        .patch(`/data-sources/${res.body.id}`)
        .send({ config: { serverUrl: 'not a url' } })
        .expect(400);
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [DEPLOYMENTS] });
      const patched = await api
        .patch(`/data-sources/${res.body.id}`)
        .send({ config: { serverUrl: 'http://localhost:18006/mcp' } })
        .expect(200);
      expect(patched.body.config.serverUrl).toBe('http://localhost:18006/mcp');
    });

    it('creates a GITHUB source (token required) and an MCP source without credentials', async () => {
      const api = as(app, owner, orgId);
      await api
        .post('/data-sources')
        .send({ name: 'gh', type: 'GITHUB', config: { owner: 'acme', repo: 'shop' } })
        .expect(400);
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [DEPLOYMENTS] });
      const gh = await api
        .post('/data-sources')
        .send({
          name: 'gh',
          type: 'GITHUB',
          config: { owner: 'acme', repo: 'shop' },
          credentials: { token: 'ghp_secret' },
        })
        .expect(201);
      expect(gh.body).toMatchObject({ type: 'GITHUB', config: { owner: 'acme', repo: 'shop' } });
      expect(mocks.ingestion.connect.mock.calls.at(-1)[0]).toMatchObject({
        type: 'GITHUB',
        credentials: { token: 'ghp_secret' },
      });

      mocks.ingestion.connect.mockResolvedValueOnce({ ok: false, error: 'connection refused' });
      const open = await api
        .post('/data-sources')
        .send({ name: 'open mcp', type: 'MCP', config: { serverUrl: 'http://localhost:9/mcp' } })
        .expect(201);
      expect(open.body.status).toBe('ERROR');
      expect(mocks.ingestion.connect.mock.calls.at(-1)[0].credentials).toBeNull();

      await api.delete(`/data-sources/${gh.body.id}`).expect(204);
      await api.delete(`/data-sources/${open.body.id}`).expect(204);
    });
  });

  describe('monitors', () => {
    it('suggests monitors for connected tabular tables', async () => {
      const res = await as(app, viewer, orgId).get('/monitors/suggestions').expect(200);
      const keys = res.body
        .filter((s: { dataSourceId: string }) => s.dataSourceId === ordersId)
        .map((s: { metricKey: string }) => s.metricKey);
      expect(keys).toEqual(['revenue', 'orders', 'refunds', 'customers']);
      // MCP/GITHUB event feeds are not monitored.
      expect(res.body.every((s: { tableName: string }) => s.tableName === 'orders')).toBe(true);
    });

    it('creates, lists, updates and enforces roles', async () => {
      const m = as(app, member, orgId);
      const body = {
        name: 'Daily revenue',
        projectId,
        dataSourceId: ordersId,
        metricKey: 'revenue',
        tableName: 'orders',
        timeColumn: 'created_at',
        valueColumn: 'amount',
        aggregation: 'sum',
        unit: 'USD',
      };
      await as(app, viewer, orgId).post('/monitors').send(body).expect(403);
      const bad = await m
        .post('/monitors')
        .send({ ...body, valueColumn: 'nope', filter: { column: 'ghost', op: 'eq', value: 1 } })
        .expect(400);
      expect(bad.body.issues.map((i: { path: string }) => i.path)).toEqual([
        'valueColumn',
        'filter.column',
      ]);
      await m
        .post('/monitors')
        .send({ ...body, dataSourceId: randomUUID() })
        .expect(404);
      await m
        .post('/monitors')
        .send({ ...body, tableName: 'missing' })
        .expect(400);

      const created = await m.post('/monitors').send(body).expect(201);
      monitorId = created.body.id;
      expect(created.body).toMatchObject({
        name: 'Daily revenue',
        dataSource: { id: ordersId, name: 'orders' },
        minSeverity: 'HIGH',
        lookbackDays: 7,
        cooldownHours: 24,
        enabled: true,
        lastStatus: null,
        investigationsCount: 0,
        latestInvestigation: null,
        createdByUserId: member.id,
      });

      const sugg = await m.get('/monitors/suggestions').expect(200);
      expect(sugg.body.map((s: { metricKey: string }) => s.metricKey)).not.toContain('revenue');

      const patched = await m
        .patch(`/monitors/${monitorId}`)
        .send({ lookbackDays: 10, minSeverity: 'MEDIUM' })
        .expect(200);
      expect(patched.body).toMatchObject({ lookbackDays: 10, minSeverity: 'MEDIUM' });
      await m.patch(`/monitors/${monitorId}`).send({ lookbackDays: 7, minSeverity: 'HIGH' });

      const list = await as(app, viewer, orgId).get('/monitors').expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).toContain(monitorId);
      expect(
        await prisma.auditLog.count({ where: { action: 'monitor.create', resourceId: monitorId } }),
      ).toBe(1);

      // Delete is ADMIN+.
      const tmp = await m
        .post('/monitors')
        .send({ ...body, metricKey: 'tmp' })
        .expect(201);
      await m.delete(`/monitors/${tmp.body.id}`).expect(403);
      await as(app, owner, orgId).delete(`/monitors/${tmp.body.id}`).expect(204);
      await as(app, owner, orgId).get(`/monitors/${tmp.body.id}`).expect(404);
    });

    it('run opens one autonomous investigation, runs it, notifies members, then dedupes', async () => {
      mocks.analyticsEngine.detectAnomalies.mockResolvedValue(detection());
      mocks.agentRuntime.runInvestigation.mockResolvedValueOnce(multiAgentResult(ordersId));
      const m = as(app, member, orgId);

      const res = await m.post(`/monitors/${monitorId}/run`).expect(200);
      expect(res.body).toMatchObject({
        monitorId,
        status: 'investigation_opened',
        anomaly: { date: '2026-10-08', direction: 'drop', severity: 'HIGH' },
      });
      autonomousId = res.body.investigationId;
      expect(mocks.analyticsEngine.detectAnomalies.mock.calls.at(-1)[0]).toMatchObject({
        dataset: { dataSourceId: ordersId, organizationId: orgId, table: 'orders' },
        aggregation: 'sum',
        method: 'auto',
        metricName: 'Daily revenue',
      });
      await runner.whenIdle();

      const sent = mocks.agentRuntime.runInvestigation.mock.calls.at(-1)[0];
      expect(sent.investigation).toMatchObject({
        id: autonomousId,
        triggerType: 'ANOMALY_DETECTED',
        triggerContext: { monitorId, date: '2026-10-08', direction: 'drop' },
      });

      const d = (await m.get(`/investigations/${autonomousId}`).expect(200)).body;
      expect(d).toMatchObject({
        status: 'COMPLETED',
        triggerType: 'ANOMALY_DETECTED',
        createdByUserId: null,
        monitorId,
        monitor: { id: monitorId, name: 'Daily revenue' },
        dedupeKey: `${monitorId}:2026-10-08:drop`,
        question: 'Investigate the 39.8% drop in Daily revenue detected on Thursday 2026-10-08',
        triggerContext: { metricKey: 'revenue', severity: 'HIGH', value: 19950, table: 'orders' },
        meta: { planner: 'rules' },
      });
      expect(d.events[0]).toMatchObject({
        type: 'investigation.created',
        payload: { trigger: { monitorId, date: '2026-10-08' } },
      });

      // Every member (all roles) got "opened" and "completed".
      for (const u of [owner, member, viewer]) {
        const types = (await as(app, u).get('/notifications').expect(200)).body
          .filter((n: { link: string }) => n.link === `/investigations/${autonomousId}`)
          .map((n: { type: string }) => n.type)
          .sort();
        expect(types).toEqual([
          'investigation.autonomous_completed',
          'investigation.autonomous_opened',
        ]);
      }
      const count = await as(app, viewer).get('/notifications/unread-count').expect(200);
      expect(count.body).toEqual({ count: 2 });

      expect(
        await prisma.auditLog.count({
          where: { action: 'monitor.investigation_opened', resourceId: monitorId },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { action: 'monitor.run', resourceId: monitorId } }),
      ).toBe(1);

      // Same anomaly again: deduped, no new investigation.
      const again = await m.post(`/monitors/${monitorId}/run`).expect(200);
      expect(again.body).toMatchObject({ status: 'deduped', investigationId: autonomousId });
      const all = await m.post('/monitors/run').expect(200);
      expect(all.body).toEqual([expect.objectContaining({ monitorId, status: 'deduped' })]);
      expect(await prisma.investigation.count({ where: { monitorId } })).toBe(1);

      const list = (await m.get('/monitors').expect(200)).body.find(
        (x: { id: string }) => x.id === monitorId,
      );
      expect(list).toMatchObject({
        lastStatus: 'deduped',
        investigationsCount: 1,
        latestInvestigation: { id: autonomousId, status: 'COMPLETED' },
      });
      expect(list.lastRunAt).not.toBeNull();

      const auto = await m.get('/investigations?triggerType=ANOMALY_DETECTED').expect(200);
      expect(auto.body.map((i: { id: string }) => i.id)).toEqual([autonomousId]);
    });

    it('records engine failures on the monitor', async () => {
      mocks.analyticsEngine.detectAnomalies.mockRejectedValueOnce(new Error('boom'));
      const res = await as(app, member, orgId).post(`/monitors/${monitorId}/run`).expect(200);
      expect(res.body).toMatchObject({ status: 'error' });
      const row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitorId } });
      expect(row).toMatchObject({ lastStatus: 'error' });
      expect(row.lastMessage).toMatch(/boom/);
    });

    it('the background loop is not running under test', () => {
      expect(app.get(MonitoringService).loopRunning).toBe(false);
    });

    it('lists anomalies with the investigation that found them', async () => {
      const res = await as(app, viewer, orgId).get('/anomalies?limit=10').expect(200);
      expect(res.body[0]).toMatchObject({
        severity: 'HIGH',
        metricName: 'revenue',
        unit: 'USD',
        dataSource: { id: ordersId, name: 'orders' },
        investigationId: autonomousId,
      });
      await as(app, viewer, orgId).get('/anomalies?limit=0').expect(400);
    });

    it('lists each anomaly once even when several investigations stored a copy', async () => {
      const before = await as(app, viewer, orgId).get('/anomalies?limit=10').expect(200);
      const original = await prisma.anomaly.findUniqueOrThrow({ where: { id: before.body[0].id } });
      await prisma.anomaly.create({
        data: {
          organizationId: original.organizationId,
          metricId: original.metricId,
          dataSourceId: original.dataSourceId,
          description: original.description,
          severity: original.severity,
          detectedAt: original.detectedAt,
          detectionMethod: original.detectionMethod,
          value: original.value,
          expectedValue: original.expectedValue,
          deviationScore: original.deviationScore,
        },
      });
      const after = await as(app, viewer, orgId).get('/anomalies?limit=10').expect(200);
      expect(after.body).toHaveLength(before.body.length);
    });
  });

  describe('trace', () => {
    it('returns plan, tasks, messages, snapshots and the evidence graph', async () => {
      const t = (
        await as(app, viewer, orgId).get(`/investigations/${autonomousId}/trace`).expect(200)
      ).body;
      expect(t.investigation).toMatchObject({
        id: autonomousId,
        triggerType: 'ANOMALY_DETECTED',
        monitor: { id: monitorId, name: 'Daily revenue' },
        triggerContext: { date: '2026-10-08' },
      });
      expect(t.meta).toMatchObject({ planner: 'rules', llmCalls: 0 });
      expect(t.steps.map((s: { agentType: string }) => s.agentType)).toEqual([
        'ANALYTICS',
        'COORDINATOR',
      ]);
      expect(t.messages.map((m: { type: string }) => m.type)).toEqual([
        'TASK_REQUEST',
        'TASK_RESULT',
      ]);
      expect(t.contextSnapshots).toHaveLength(2);

      const analytics = t.tasks.find((x: { agentType: string }) => x.agentType === 'ANALYTICS');
      const synth = t.tasks.find((x: { agentType: string }) => x.agentType === 'COORDINATOR');
      expect(analytics.contextSnapshotId).toBe(
        t.contextSnapshots.find((c: { agentType: string }) => c.agentType === 'ANALYTICS').id,
      );
      expect(analytics.evidenceIds).toHaveLength(1);
      const root = t.findings.find((f: { isRootCause: boolean }) => f.isRootCause);
      expect(root.agentTaskId).toBe(synth.id);
      expect(synth.findingIds).toEqual([root.id]);
      expect(t.recommendations[0].findingIds).toHaveLength(1);

      const types = new Set(t.graph.nodes.map((n: { type: string }) => n.type));
      expect([...types].sort()).toEqual(
        ['evidence', 'finding', 'question', 'recommendation', 'rootCause', 'step', 'task'].sort(),
      );
      expect(t.graph.edges).toContainEqual({ from: synth.id, to: root.id, kind: 'selected' });
      const kinds = new Set(t.graph.edges.map((e: { kind: string }) => e.kind));
      expect(kinds).toEqual(
        new Set(['plans', 'runs', 'collected', 'supports', 'justifies', 'selected']),
      );

      await as(app, viewer, orgId).get(`/investigations/${randomUUID()}/trace`).expect(404);
    });
  });

  describe('internal context', () => {
    it('returns recent metrics, anomalies and findings of finished investigations', async () => {
      await request(app.getHttpServer())
        .get(`${API}/internal/organizations/${orgId}/context`)
        .expect(401);
      const res = await internal(
        `/organizations/${orgId}/context?dataSourceIds=${ordersId}&sinceDays=30&limit=5`,
      ).expect(200);
      expect(res.body.metrics[0]).toMatchObject({
        name: 'revenue',
        unit: 'USD',
        dataSourceId: ordersId,
      });
      expect(res.body.anomalies[0]).toMatchObject({ severity: 'HIGH', dataSourceId: ordersId });
      expect(
        res.body.findings.map((f: { investigationId: string }) => f.investigationId),
      ).toContain(autonomousId);
      expect(res.body.findings[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          statement: expect.any(String),
          confidence: expect.any(Number),
          isRootCause: expect.any(Boolean),
          agentType: expect.any(String),
        }),
      );

      const excluded = await internal(
        `/organizations/${orgId}/context?excludeInvestigationId=${autonomousId}`,
      ).expect(200);
      expect(excluded.body.findings).toEqual([]);
      const other = await internal(
        `/organizations/${orgId}/context?dataSourceIds=${randomUUID()}`,
      ).expect(200);
      expect(other.body).toMatchObject({ metrics: [], anomalies: [] });
      await internal(`/organizations/${orgId}/context?dataSourceIds=nope`).expect(400);
    });
  });

  describe('agents', () => {
    it('falls back to every known agent and passes contextRequirements through', async () => {
      mocks.agentRuntime.listAgents.mockRejectedValueOnce(new Error('down'));
      const down = await as(app, viewer, orgId).get('/agents').expect(200);
      expect(down.body.map((a: { type: string }) => a.type)).toEqual([
        'COORDINATOR',
        'ANALYTICS',
        'FINANCE',
        'CUSTOMER',
        'PRODUCT',
      ]);
      expect(down.body[0]).toMatchObject({ status: 'UNAVAILABLE', contextRequirements: null });

      mocks.agentRuntime.listAgents.mockResolvedValueOnce([
        {
          type: 'PRODUCT',
          name: 'Product',
          status: 'IDLE',
          capabilities: [{ name: 'deployment_correlation', description: 'd' }],
          contextRequirements: { dataSourceTypes: ['MCP', 'GITHUB'] },
        },
      ]);
      const up = await as(app, viewer, orgId).get('/agents').expect(200);
      expect(up.body[0]).toMatchObject({
        type: 'PRODUCT',
        contextRequirements: { dataSourceTypes: ['MCP', 'GITHUB'] },
      });
    });
  });
});
