import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { UpstreamError } from '../src/clients/http';
import { InvestigationRunnerService } from '../src/runner/investigation-runner.service';
import {
  as,
  buildRunResult,
  createApp,
  createOrg,
  mockClients,
  ORDERS_SCHEMA,
  signup,
  TestUser,
} from './helpers';

/** Phase 5: POST /investigations runs the Coordinator (agent runtime mocked) and persists the trail. */
describe('Investigation runner (e2e)', () => {
  const mocks = mockClients();
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: InvestigationRunnerService;
  let user: TestUser;
  let orgId: string;
  let projectId: string;
  let dataSourceId: string;

  beforeAll(async () => {
    app = await createApp(mocks);
    prisma = app.get(PrismaService);
    runner = app.get(InvestigationRunnerService);
    user = await signup(app, 'runner');
    orgId = await createOrg(app, user, 'Runner Co');
    const api = as(app, user, orgId);
    projectId = (await api.post('/projects').send({ name: 'Revenue' }).expect(201)).body.id;

    mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS_SCHEMA] });
    dataSourceId = (
      await api
        .post('/data-sources')
        .send({
          name: 'orders',
          type: 'POSTGRESQL',
          config: { host: 'h', database: 'd' },
          credentials: { user: 'u', password: 'p' },
        })
        .expect(201)
    ).body.id;
    // A broken source must not be handed to the Coordinator.
    mocks.ingestion.connect.mockResolvedValueOnce({ ok: false, error: 'nope' });
    await api
      .post('/data-sources')
      .send({
        name: 'broken',
        type: 'POSTGRESQL',
        config: { host: 'h', database: 'd' },
        credentials: { user: 'u', password: 'p' },
      })
      .expect(201);
  });

  afterAll(async () => {
    await runner.whenIdle();
    await app.close();
  });

  it('happy path: completes and persists steps, tasks, evidence, findings, recommendations, metrics', async () => {
    const result = buildRunResult({ dataSourceId });
    mocks.agentRuntime.runInvestigation.mockResolvedValueOnce(result);
    const api = as(app, user, orgId);

    const created = await api
      .post('/investigations')
      .send({ projectId, question: 'Why did revenue drop on October 8?' })
      .expect(201);
    expect(created.body.status).toBe('PENDING');
    await runner.whenIdle();

    const sent = mocks.agentRuntime.runInvestigation.mock.calls.at(-1)[0];
    expect(sent.investigation).toMatchObject({
      id: created.body.id,
      organizationId: orgId,
      projectId,
      triggerType: 'USER_QUESTION',
    });
    expect(sent.dataSources).toEqual([
      expect.objectContaining({
        id: dataSourceId,
        name: 'orders',
        type: 'POSTGRESQL',
        schemas: [expect.objectContaining({ tableName: 'orders' })],
      }),
    ]);

    const d = (await api.get(`/investigations/${created.body.id}`).expect(200)).body;
    expect(d).toMatchObject({
      status: 'COMPLETED',
      summary: result.summary,
      overallConfidence: 0.9,
      rootCauseFindingId: result.rootCauseFindingId,
      plan: { steps: [expect.objectContaining({ agentType: 'ANALYTICS' })] },
    });
    expect(d.startedAt).not.toBeNull();
    expect(d.completedAt).not.toBeNull();
    expect(d.steps).toEqual([
      expect.objectContaining({ id: result.steps[0]!.id, order: 0, agentType: 'ANALYTICS' }),
    ]);
    expect(d.tasks).toEqual([
      expect.objectContaining({
        id: result.tasks[0]!.id,
        status: 'SUCCEEDED',
        investigationStepId: result.steps[0]!.id,
      }),
    ]);
    expect(d.findings).toEqual([
      expect.objectContaining({
        id: result.findings[0]!.id,
        isRootCause: true,
        evidence: [result.evidence[0]!.summary],
        evidenceItems: [
          expect.objectContaining({ id: result.evidence[0]!.id, sourceType: 'ANOMALY' }),
        ],
      }),
    ]);
    expect(d.recommendations).toEqual([
      expect.objectContaining({
        title: result.recommendations[0]!.title,
        action: result.recommendations[0]!.title,
        priority: 'HIGH',
      }),
    ]);
    expect(d.events.map((e: { type: string }) => e.type)).toEqual([
      'investigation.created',
      'investigation.completed',
    ]);

    const metric = await prisma.metric.findUniqueOrThrow({ where: { id: result.metrics[0]!.id } });
    expect(metric).toMatchObject({ organizationId: orgId, dataSourceId, name: 'revenue' });
    const anomaly = await prisma.anomaly.findUniqueOrThrow({
      where: { id: result.anomalies[0]!.id },
    });
    expect(anomaly).toMatchObject({ organizationId: orgId, metricId: metric.id, severity: 'HIGH' });

    const notes = (await as(app, user).get('/notifications?unread=true').expect(200)).body;
    expect(notes[0]).toMatchObject({
      title: 'Investigation completed',
      link: `/investigations/${created.body.id}`,
      organizationId: orgId,
    });

    const agents = await (async () => {
      mocks.agentRuntime.listAgents.mockResolvedValueOnce([
        {
          type: 'ANALYTICS',
          name: 'Analytics',
          description: 'd',
          version: '0.1.0',
          status: 'IDLE',
          capabilities: [{ name: 'detect_anomalies', description: 'x' }],
        },
      ]);
      return (await api.get('/agents').expect(200)).body;
    })();
    expect(agents).toEqual([
      expect.objectContaining({
        type: 'ANALYTICS',
        status: 'IDLE',
        tasks: 1,
        successRate: 1,
        avgMs: 0,
      }),
    ]);
  });

  it('agent runtime down: FAILED with an explanatory summary, event, and notification', async () => {
    mocks.agentRuntime.runInvestigation.mockRejectedValueOnce(
      new UpstreamError('http://localhost:8001 unreachable: fetch failed', null),
    );
    const api = as(app, user, orgId);
    const created = await api
      .post('/investigations')
      .send({ projectId, question: 'Is anything broken?' })
      .expect(201);
    await runner.whenIdle();

    const d = (await api.get(`/investigations/${created.body.id}`).expect(200)).body;
    expect(d.status).toBe('FAILED');
    expect(d.summary).toMatch(/agent runtime is unreachable/);
    expect(d.completedAt).not.toBeNull();
    expect(d.events.map((e: { type: string }) => e.type)).toEqual([
      'investigation.created',
      'investigation.failed',
    ]);
    expect(d.findings).toEqual([]);

    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, link: `/investigations/${created.body.id}` },
    });
    expect(n.title).toBe('Investigation failed');

    // The API stays healthy.
    await api.get('/dashboard/summary').expect(200);
  });

  it('a runtime-reported FAILED result is stored as FAILED, trail included', async () => {
    const result = buildRunResult({ dataSourceId, status: 'FAILED' });
    result.tasks[0]!.status = 'FAILED';
    result.tasks[0]!.error = 'analytics engine returned 422';
    mocks.agentRuntime.runInvestigation.mockResolvedValueOnce(result);
    const api = as(app, user, orgId);
    const created = await api
      .post('/investigations')
      .send({ projectId, question: 'Will this fail?' })
      .expect(201);
    await runner.whenIdle();
    const d = (await api.get(`/investigations/${created.body.id}`).expect(200)).body;
    expect(d.status).toBe('FAILED');
    expect(d.tasks[0]).toMatchObject({ status: 'FAILED', error: 'analytics engine returned 422' });
    expect(d.events.map((e: { type: string }) => e.type)).toContain('investigation.failed');
  });
});
