import { randomUUID } from 'node:crypto';
import { Prisma } from '@helix/database';
import { UpstreamError } from '../clients/http';
import type { AgentRuntimeClient } from '../clients/agent-runtime.client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { InvestigationRunnerService } from './investigation-runner.service';

const ORG = randomUUID();
const DS = randomUUID();
const inv = {
  id: randomUUID(),
  organizationId: ORG,
  projectId: randomUUID(),
  createdByUserId: randomUUID(),
  question: 'Why did revenue drop?',
  triggerType: 'USER_QUESTION',
  status: 'PENDING',
};

function runResult() {
  const stepId = randomUUID();
  const taskId = randomUUID();
  const metricId = randomUUID();
  const evidenceId = randomUUID();
  const findingId = randomUUID();
  return {
    status: 'COMPLETED',
    plan: {
      steps: [{ order: 0, agentType: 'ANALYTICS', objective: 'Analyze revenue', dependsOn: [] }],
      reasoning: 'r',
    },
    steps: [
      { id: stepId, order: 0, agentType: 'ANALYTICS', objective: 'Analyze revenue', dependsOn: [] },
    ],
    tasks: [
      {
        id: taskId,
        stepId,
        agentType: 'ANALYTICS',
        status: 'SUCCEEDED',
        objective: 'Analyze revenue',
        inputContext: {},
        result: { ok: true },
        error: null,
        startedAt: '2026-10-14T09:00:00Z',
        completedAt: '2026-10-14T09:00:02Z',
        timeoutMs: 60000,
      },
    ],
    evidence: [
      {
        id: evidenceId,
        agentTaskId: taskId,
        sourceType: 'ANOMALY',
        source: { description: 'anomaly detector' },
        summary: 'Revenue dropped 40% on 2026-10-08',
        data: { metricId },
        confidence: 0.9,
        collectedAt: '2026-10-14T09:00:01Z',
      },
      // Dangling: references a task that was never sent. Must be dropped, not crash.
      {
        id: randomUUID(),
        agentTaskId: randomUUID(),
        sourceType: 'METRIC',
        source: {},
        summary: 'x',
        confidence: 0.5,
      },
    ],
    findings: [
      {
        id: findingId,
        agentTaskId: taskId,
        agentType: 'ANALYTICS',
        analyticsType: 'DIAGNOSTIC',
        statement: 'Web channel revenue collapsed',
        confidence: 0.88,
        isRootCause: true,
        evidenceIds: [evidenceId],
      },
    ],
    recommendations: [
      {
        id: randomUUID(),
        title: 'Check web checkout',
        description: 'd',
        priority: 'HIGH',
        expectedImpact: null,
        findingIds: [findingId],
      },
    ],
    metrics: [
      {
        id: metricId,
        dataSourceId: DS,
        name: 'revenue',
        unit: 'USD',
        value: 100,
        baseline: 170,
        changePercent: -41,
        series: [],
        computationMethod: 'daily sum',
        computedAt: '2026-10-14T09:00:01Z',
      },
    ],
    anomalies: [
      {
        id: randomUUID(),
        metricId,
        dataSourceId: randomUUID(), // not in this org: must be nulled
        description: 'drop',
        severity: 'HIGH',
        detectedAt: '2026-10-08T00:00:00Z',
        detectionMethod: 'robust zscore',
        value: 100,
        expectedValue: 170,
        deviationScore: -5.1,
      },
    ],
    summary: 'Revenue fell because web checkout broke.',
    overallConfidence: 0.88,
    rootCauseFindingId: findingId,
  };
}

function setup(opts: { status?: string; inv?: Record<string, unknown> } = {}) {
  const tx = {
    investigation: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ status: opts.status ?? 'IN_PROGRESS', startedAt: null }),
      update: jest.fn(),
    },
    dataSource: { findMany: jest.fn().mockResolvedValue([{ id: DS }]) },
    investigationStep: { createMany: jest.fn() },
    agentTask: { createMany: jest.fn() },
    metric: { createMany: jest.fn() },
    anomaly: { createMany: jest.fn() },
    evidence: { createMany: jest.fn() },
    finding: { createMany: jest.fn() },
    findingEvidence: { createMany: jest.fn() },
    recommendation: { createMany: jest.fn() },
    recommendationFinding: { createMany: jest.fn() },
    agentMessage: { createMany: jest.fn() },
    contextSnapshot: { createMany: jest.fn() },
  };
  const prisma = {
    investigation: {
      findUnique: jest.fn().mockResolvedValue(opts.inv ?? inv),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dataSource: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: DS,
            name: 'orders',
            type: 'CSV',
            schemas: [{ tableName: 'orders', columns: [], rowCountEstimate: 10 }],
          },
        ]),
    },
    investigationEvent: { create: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const agentRuntime = { runInvestigation: jest.fn(), listAgents: jest.fn() };
  const notifications = { create: jest.fn(), notifyOrganization: jest.fn() };
  const runner = new InvestigationRunnerService(
    prisma as unknown as PrismaService,
    agentRuntime as unknown as AgentRuntimeClient,
    notifications as unknown as NotificationsService,
  );
  return { runner, prisma, tx, agentRuntime, notifications };
}

const eventTypes = (prisma: ReturnType<typeof setup>['prisma']) =>
  prisma.investigationEvent.create.mock.calls.map((c) => c[0].data.type);

describe('InvestigationRunnerService', () => {
  it('sends only CONNECTED data sources with their schemas', async () => {
    const { runner, prisma, agentRuntime } = setup();
    agentRuntime.runInvestigation.mockResolvedValue(runResult());
    await runner.run(inv.id);
    expect(prisma.dataSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, status: 'CONNECTED' } }),
    );
    const body = agentRuntime.runInvestigation.mock.calls[0][0];
    expect(body.investigation).toMatchObject({
      id: inv.id,
      question: inv.question,
      triggerType: 'USER_QUESTION',
    });
    expect(body.dataSources[0]).toMatchObject({ id: DS, schemas: [{ tableName: 'orders' }] });
  });

  it('persists the whole trail in one transaction and completes', async () => {
    const { runner, prisma, tx, agentRuntime, notifications } = setup();
    const result = runResult();
    agentRuntime.runInvestigation.mockResolvedValue(result);
    await runner.run(inv.id);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.investigationStep.createMany.mock.calls[0][0].data[0]).toMatchObject({
      id: result.steps[0]!.id,
      investigationId: inv.id,
    });
    expect(tx.agentTask.createMany.mock.calls[0][0].data[0]).toMatchObject({
      id: result.tasks[0]!.id,
      investigationStepId: result.steps[0]!.id,
    });
    // Dangling evidence dropped.
    expect(tx.evidence.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(tx.metric.createMany.mock.calls[0][0].data[0]).toMatchObject({
      organizationId: ORG,
      dataSourceId: DS,
    });
    // Foreign data source id nulled, metric link kept.
    expect(tx.anomaly.createMany.mock.calls[0][0].data[0]).toMatchObject({
      dataSourceId: null,
      metricId: result.metrics[0]!.id,
    });
    expect(tx.findingEvidence.createMany.mock.calls[0][0].data).toEqual([
      { findingId: result.findings[0]!.id, evidenceId: result.evidence[0]!.id },
    ]);
    expect(tx.recommendationFinding.createMany.mock.calls[0][0].data).toHaveLength(1);

    const update = tx.investigation.update.mock.calls[0][0].data;
    expect(update).toMatchObject({
      status: 'COMPLETED',
      summary: result.summary,
      overallConfidence: 0.88,
      rootCauseFindingId: result.rootCauseFindingId,
    });
    expect(update.startedAt).toBeInstanceOf(Date);
    expect(update.completedAt).toBeInstanceOf(Date);

    expect(eventTypes(prisma)).toEqual(['investigation.completed']);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: inv.createdByUserId,
        title: 'Investigation completed',
        link: `/investigations/${inv.id}`,
      }),
    );
  });

  it('keeps CANCELLED when the user cancelled mid-run, but still stores the trail', async () => {
    const { runner, tx, agentRuntime, notifications } = setup({ status: 'CANCELLED' });
    agentRuntime.runInvestigation.mockResolvedValue(runResult());
    await runner.run(inv.id);
    expect(tx.finding.createMany).toHaveBeenCalled();
    expect(tx.investigation.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('fails cleanly when the agent runtime is unreachable', async () => {
    const { runner, prisma, agentRuntime, notifications } = setup();
    agentRuntime.runInvestigation.mockRejectedValue(
      new UpstreamError('http://localhost:8001 unreachable: ECONNREFUSED', null),
    );
    await expect(runner.run(inv.id)).resolves.toBeUndefined();

    const update = prisma.investigation.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe('FAILED');
    expect(update.data.summary).toMatch(/agent runtime is unreachable/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(eventTypes(prisma)).toEqual(['investigation.failed']);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Investigation failed' }),
    );
  });

  it('fails cleanly on a malformed result without writing anything', async () => {
    const { runner, prisma, agentRuntime } = setup();
    agentRuntime.runInvestigation.mockResolvedValue({ status: 'WHATEVER' });
    await runner.run(inv.id);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.investigation.updateMany.mock.calls[0][0].data.summary).toMatch(/invalid result/);
  });

  it('stores a FAILED run result as FAILED with a fallback summary', async () => {
    const { runner, prisma, tx, agentRuntime } = setup();
    agentRuntime.runInvestigation.mockResolvedValue({
      ...runResult(),
      status: 'FAILED',
      summary: null,
    });
    await runner.run(inv.id);
    expect(tx.investigation.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
    expect(tx.investigation.update.mock.calls[0][0].data.summary).toBeTruthy();
    expect(eventTypes(prisma)).toEqual(['investigation.failed']);
  });

  it('stores null JSON as a database NULL', async () => {
    const { runner, tx, agentRuntime } = setup();
    const r = runResult();
    r.tasks[0]!.result = null as unknown as { ok: boolean };
    agentRuntime.runInvestigation.mockResolvedValue(r);
    await runner.run(inv.id);
    expect(tx.agentTask.createMany.mock.calls[0][0].data[0].result).toBe(Prisma.DbNull);
  });

  it('persists A2A messages and context snapshots, dropping links to unknown tasks', async () => {
    const { runner, tx, agentRuntime } = setup();
    const r = runResult();
    const taskId = r.tasks[0]!.id;
    const correlationId = taskId;
    const messages = [
      {
        id: randomUUID(),
        type: 'TASK_REQUEST',
        agentTaskId: taskId,
        fromAgent: 'COORDINATOR',
        toAgent: 'ANALYTICS',
        payload: { objective: 'Analyze revenue', transport: 'a2a-gateway' },
        correlationId,
        createdAt: '2026-10-14T09:00:00Z',
      },
      {
        id: randomUUID(),
        type: 'TASK_RESULT',
        agentTaskId: randomUUID(), // not a task in this run
        fromAgent: 'ANALYTICS',
        toAgent: 'COORDINATOR',
        payload: { status: 'SUCCEEDED', findings: 1 },
        correlationId,
        createdAt: '2026-10-14T09:00:02Z',
      },
    ];
    const contextSnapshots = [
      {
        id: randomUUID(),
        agentTaskId: taskId,
        agentType: 'ANALYTICS',
        assembledContext: { source: 'context-engine', decisions: [] },
        tokenCount: 412,
        createdAt: '2026-10-14T09:00:00Z',
      },
    ];
    agentRuntime.runInvestigation.mockResolvedValue({
      ...r,
      messages,
      contextSnapshots,
      meta: { planner: 'rules', llmCalls: 0 },
    });
    await runner.run(inv.id);

    const rows = tx.agentMessage.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: messages[0]!.id,
      investigationId: inv.id,
      agentTaskId: taskId,
      type: 'TASK_REQUEST',
      fromAgent: 'COORDINATOR',
      toAgent: 'ANALYTICS',
      correlationId,
      payload: messages[0]!.payload,
    });
    expect(rows[0].createdAt).toEqual(new Date('2026-10-14T09:00:00Z'));
    expect(rows[1].agentTaskId).toBeNull();
    expect(tx.contextSnapshot.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        id: contextSnapshots[0]!.id,
        investigationId: inv.id,
        agentTaskId: taskId,
        agentType: 'ANALYTICS',
        tokenCount: 412,
        assembledContext: contextSnapshots[0]!.assembledContext,
      }),
    ]);
  });

  it('stores meta in the completed event and accepts a Phase 5 result without the new fields', async () => {
    const { runner, prisma, tx, agentRuntime } = setup();
    agentRuntime.runInvestigation.mockResolvedValue({ ...runResult(), meta: { planner: 'llm' } });
    await runner.run(inv.id);
    const completed = prisma.investigationEvent.create.mock.calls[0][0].data;
    expect(completed.payload.meta).toEqual({ planner: 'llm' });

    const second = setup();
    second.agentRuntime.runInvestigation.mockResolvedValue(runResult());
    await second.runner.run(inv.id);
    expect(second.tx.agentMessage.createMany.mock.calls[0][0].data).toEqual([]);
    expect(second.prisma.investigationEvent.create.mock.calls[0][0].data.payload.meta).toEqual({});
    expect(tx.investigation.update).toHaveBeenCalled();
  });

  it('accepts COORDINATOR findings and sends triggerContext to the runtime', async () => {
    const trigger = { monitorId: randomUUID(), date: '2026-10-08', direction: 'drop' };
    const { runner, tx, agentRuntime } = setup({
      inv: { ...inv, triggerType: 'ANOMALY_DETECTED', triggerContext: trigger },
    });
    const r = runResult();
    r.findings[0]!.agentType = 'COORDINATOR';
    agentRuntime.runInvestigation.mockResolvedValue(r);
    await runner.run(inv.id);
    expect(agentRuntime.runInvestigation.mock.calls[0][0].investigation).toMatchObject({
      triggerType: 'ANOMALY_DETECTED',
      triggerContext: trigger,
    });
    expect(tx.finding.createMany.mock.calls[0][0].data[0].agentType).toBe('COORDINATOR');
  });

  it('notifies every org member when an investigation has no creator', async () => {
    const { runner, agentRuntime, notifications } = setup({
      inv: { ...inv, createdByUserId: null, triggerType: 'ANOMALY_DETECTED' },
    });
    agentRuntime.runInvestigation.mockResolvedValue(runResult());
    await runner.run(inv.id);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.notifyOrganization).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        type: 'investigation.autonomous_completed',
        title: 'Autonomous investigation completed',
        link: `/investigations/${inv.id}`,
      }),
    );

    const down = setup({ inv: { ...inv, createdByUserId: null } });
    down.agentRuntime.runInvestigation.mockRejectedValue(new UpstreamError('down', null));
    await down.runner.run(inv.id);
    expect(down.notifications.notifyOrganization).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ type: 'investigation.autonomous_failed' }),
    );
  });
});
