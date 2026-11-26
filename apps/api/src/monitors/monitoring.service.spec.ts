import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@helix/database';
import type { AuditService } from '../audit/audit.service';
import type { AnalyticsEngineClient } from '../clients/analytics-engine.client';
import { UpstreamError } from '../clients/http';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { InvestigationRunnerService } from '../runner/investigation-runner.service';
import { MonitoringService } from './monitoring.service';

const ORG = randomUUID();

function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    organizationId: ORG,
    projectId: randomUUID(),
    dataSourceId: randomUUID(),
    name: 'Daily revenue',
    metricKey: 'revenue',
    tableName: 'orders',
    timeColumn: 'created_at',
    valueColumn: 'amount',
    aggregation: 'sum',
    filter: null,
    unit: 'USD',
    minSeverity: 'HIGH',
    lookbackDays: 7,
    cooldownHours: 24,
    enabled: true,
    dataSource: { id: 'ds', name: 'orders.csv', status: 'CONNECTED' },
    ...overrides,
  } as never;
}

/** Daily series 2026-07-17..2026-10-14 with one HIGH revenue drop on 2026-10-08. */
function detection(anomalies?: unknown[]) {
  const series = Array.from({ length: 90 }, (_, i) => ({
    timestamp: new Date(Date.parse('2026-07-17T00:00:00Z') + i * 86_400_000).toISOString(),
    value: 33000,
  }));
  return {
    metric: { name: 'Daily revenue', unit: 'USD', value: 1, series, computationMethod: 'x' },
    methodUsed: 'seasonal',
    computationMethod: 'x',
    anomalies: anomalies ?? [
      {
        timestamp: '2026-10-08T00:00:00+00:00',
        value: 19950,
        expectedValue: 33124,
        deviationScore: -6.1,
        severity: 'HIGH',
        direction: 'drop',
        detectionMethod: 'seasonal',
        description: 'Revenue drop',
      },
    ],
  };
}

function setup(opts: { maxPerDay?: number; intervalMs?: number } = {}) {
  const prisma = {
    investigation: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    },
    monitor: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
  const engine = { detectAnomalies: jest.fn().mockResolvedValue(detection()) };
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  const notifications = { notifyOrganization: jest.fn().mockResolvedValue(2) };
  const audit = { record: jest.fn() };
  const runner = { enqueue: jest.fn() };
  const env: Record<string, number> = {
    HELIX_MONITOR_INTERVAL_MS: opts.intervalMs ?? 900_000,
    HELIX_MONITOR_MAX_PER_DAY: opts.maxPerDay ?? 5,
  };
  const config = { get: (k: string) => env[k] };
  const service = new MonitoringService(
    prisma as unknown as PrismaService,
    engine as unknown as AnalyticsEngineClient,
    redis as unknown as RedisService,
    notifications as unknown as NotificationsService,
    audit as unknown as AuditService,
    runner as unknown as InvestigationRunnerService,
    config as unknown as ConfigService<never, true>,
  );
  return { service, prisma, engine, redis, notifications, audit, runner };
}

describe('MonitoringService', () => {
  it('opens an ANOMALY_DETECTED investigation for a new severe anomaly', async () => {
    const { service, prisma, engine, redis, notifications, audit, runner } = setup();
    const m = monitor() as { id: string; projectId: string; dataSourceId: string };
    const res = await service.runMonitor(m as never);

    expect(engine.detectAnomalies).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: { dataSourceId: m.dataSourceId, organizationId: ORG, table: 'orders' },
        timeColumn: 'created_at',
        valueColumn: 'amount',
        aggregation: 'sum',
        method: 'auto',
        metricName: 'Daily revenue',
      }),
    );
    expect(res).toMatchObject({
      status: 'investigation_opened',
      investigationId: 'inv-1',
      anomaly: { date: '2026-10-08', direction: 'drop', severity: 'HIGH' },
    });
    const key = `${m.id}:2026-10-08:drop`;
    expect(redis.set).toHaveBeenCalledWith(
      `helix:monitor:dedupe:${key}`,
      '1',
      'EX',
      24 * 3600,
      'NX',
    );
    const data = prisma.investigation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: ORG,
      projectId: m.projectId,
      createdByUserId: null,
      triggerType: 'ANOMALY_DETECTED',
      monitorId: m.id,
      dedupeKey: key,
      question: 'Investigate the 39.8% drop in Daily revenue detected on Thursday 2026-10-08',
      triggerContext: {
        monitorId: m.id,
        metricKey: 'revenue',
        metricName: 'Daily revenue',
        date: '2026-10-08',
        direction: 'drop',
        severity: 'HIGH',
        value: 19950,
        expectedValue: 33124,
        deviationScore: -6.1,
        dataSourceId: m.dataSourceId,
        table: 'orders',
      },
    });
    expect(data.events.create).toMatchObject({
      type: 'investigation.created',
      payload: { trigger: data.triggerContext },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'monitor.investigation_opened', resourceId: m.id }),
    );
    expect(notifications.notifyOrganization).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ type: 'investigation.autonomous_opened' }),
    );
    expect(runner.enqueue).toHaveBeenCalledWith('inv-1');
    expect(prisma.monitor.update.mock.calls[0][0].data).toMatchObject({
      lastStatus: 'investigation_opened',
      lastRunAt: expect.any(Date),
    });
  });

  it('dedupes when an investigation with the same dedupeKey exists', async () => {
    const { service, prisma, redis, runner } = setup();
    prisma.investigation.findUnique.mockResolvedValue({ id: 'old-inv' });
    const res = await service.runMonitor(monitor());
    expect(res).toMatchObject({ status: 'deduped', investigationId: 'old-inv' });
    expect(redis.set).not.toHaveBeenCalled();
    expect(prisma.investigation.create).not.toHaveBeenCalled();
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  it('dedupes while the Redis cooldown lock is held', async () => {
    const { service, prisma, redis } = setup();
    redis.set.mockResolvedValue(null);
    const res = await service.runMonitor(monitor());
    expect(res.status).toBe('deduped');
    expect(res.message).toMatch(/24h cooldown/);
    expect(prisma.investigation.create).not.toHaveBeenCalled();
  });

  it('dedupes a concurrent duplicate caught by the unique dedupeKey', async () => {
    const { service, prisma, runner } = setup();
    prisma.investigation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    expect((await service.runMonitor(monitor())).status).toBe('deduped');
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  it('still opens the investigation when Redis is down (DB uniqueness remains)', async () => {
    const { service, redis } = setup();
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await service.runMonitor(monitor())).status).toBe('investigation_opened');
  });

  it('rate-limits at HELIX_MONITOR_MAX_PER_DAY autonomous investigations per org per day', async () => {
    const { service, prisma, redis } = setup({ maxPerDay: 2 });
    prisma.investigation.count.mockResolvedValue(2);
    const res = await service.runMonitor(monitor());
    expect(res.status).toBe('rate_limited');
    expect(res.message).toMatch(/limit 2/);
    expect(prisma.investigation.count.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      triggerType: 'ANOMALY_DETECTED',
    });
    // No lock taken, so the anomaly can still open an investigation once under the cap.
    expect(redis.set).not.toHaveBeenCalled();
    expect(prisma.monitor.update.mock.calls[0][0].data.lastStatus).toBe('rate_limited');
  });

  it('reports ok when nothing passes the lookback and severity filters', async () => {
    const { service, engine, prisma } = setup();
    engine.detectAnomalies.mockResolvedValue(
      detection([
        {
          timestamp: '2026-08-01T00:00:00Z',
          value: 1,
          expectedValue: 2,
          deviationScore: -9,
          severity: 'CRITICAL',
          direction: 'drop',
          detectionMethod: 'x',
          description: 'old',
        },
      ]),
    );
    const res = await service.runMonitor(monitor());
    expect(res).toMatchObject({ status: 'ok' });
    expect(res.message).toMatch(/up to 2026-10-14/);
    expect(prisma.investigation.create).not.toHaveBeenCalled();
  });

  it('turns engine failures and disconnected sources into status error', async () => {
    const { service, engine } = setup();
    engine.detectAnomalies.mockRejectedValue(new UpstreamError('down', null));
    const res = await service.runMonitor(monitor());
    expect(res.status).toBe('error');
    expect(res.message).toMatch(/analytics engine is unreachable/);

    const off = await service.runMonitor(
      monitor({ dataSource: { id: 'ds', name: 'warehouse', status: 'ERROR' } }),
    );
    expect(off).toMatchObject({ status: 'error' });
    expect(off.message).toMatch(/not CONNECTED/);
  });

  it('never starts the loop under NODE_ENV=test, and cycles never overlap', async () => {
    const { service, prisma } = setup({ intervalMs: 10 });
    expect(service.loopEnabled()).toBe(false);
    service.onApplicationBootstrap();
    expect(service.loopRunning).toBe(false);

    let release: (v: unknown[]) => void = () => undefined;
    prisma.monitor.findMany.mockReturnValue(new Promise((r) => (release = r)));
    const first = service.tick();
    expect(await service.tick()).toBeNull();
    release([]);
    expect(await first).toEqual([]);
    prisma.monitor.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.tick()).resolves.toEqual([]);
  });

  it('disables the loop with HELIX_MONITOR_INTERVAL_MS=0 or HELIX_DEMO=1', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(setup({ intervalMs: 0 }).service.loopEnabled()).toBe(false);
      process.env.HELIX_DEMO = '1';
      expect(setup().service.loopEnabled()).toBe(false);
      delete process.env.HELIX_DEMO;
      expect(setup().service.loopEnabled()).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
      delete process.env.HELIX_DEMO;
    }
  });
});
