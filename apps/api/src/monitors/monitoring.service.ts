import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSourceStatus,
  InvestigationTriggerType,
  Prisma,
  type DataSource,
  type Monitor,
} from '@helix/database';
import { AuditService } from '../audit/audit.service';
import {
  AnalyticsEngineClient,
  DetectAnomaliesResponse,
  EngineFilter,
} from '../clients/analytics-engine.client';
import { UpstreamError } from '../clients/http';
import type { ApiEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { InvestigationRunnerService } from '../runner/investigation-runner.service';
import {
  chooseAnomaly,
  dedupeKey,
  investigationQuestion,
  redisDedupeKey,
  type PickedAnomaly,
} from './monitor-rules';

/** Monitor.lastStatus values. */
export type MonitorRunStatus = 'ok' | 'investigation_opened' | 'deduped' | 'rate_limited' | 'error';

export interface MonitorRunAnomaly {
  date: string;
  timestamp: string;
  direction: string;
  severity: string;
  value: number;
  expectedValue: number;
  deviationScore: number;
  detectionMethod: string;
  description: string;
}

export interface MonitorRunResult {
  monitorId: string;
  monitorName: string;
  status: MonitorRunStatus;
  message: string;
  investigationId?: string;
  anomaly?: MonitorRunAnomaly;
}

/** `GET /monitors/:id/series`: the daily series a monitor watches plus every anomaly the engine sees in it. */
export interface MonitorSeriesView {
  monitorId: string;
  monitorName: string;
  unit: string | null;
  lookbackDays: number;
  minSeverity: string;
  methodUsed: string | null;
  /** Last day of the series (YYYY-MM-DD), the lookback anchor. */
  seriesEnd: string | null;
  series: { date: string; value: number | null }[];
  anomalies: MonitorRunAnomaly[];
  /** The anomaly a run would act on now (lookback and severity filters applied), or null. */
  picked: MonitorRunAnomaly | null;
}

type MonitorWithSource = Monitor & { dataSource: DataSource };

const REDIS_TIMEOUT_MS = 2_000;

/**
 * Phase 9 autonomous monitoring. A cycle asks the analytics engine for
 * anomalies on each enabled monitor's daily series and, for a new, severe
 * enough one, opens an ANOMALY_DETECTED investigation (no creator) and hands
 * it to the runner. Dedupe is two-layered: a Redis `SET NX EX cooldown` lock
 * and the unique Investigation.dedupeKey. A per-org daily cap bounds the
 * blast radius. The background loop is a plain setInterval that never
 * overlaps itself and never throws; it is off under NODE_ENV=test,
 * HELIX_DEMO=1 or HELIX_MONITOR_INTERVAL_MS=0.
 */
@Injectable()
export class MonitoringService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly intervalMs: number;
  private readonly maxPerDay: number;
  private timer: NodeJS.Timeout | null = null;
  private cycle: Promise<MonitorRunResult[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AnalyticsEngineClient,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly runner: InvestigationRunnerService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.intervalMs = config.get('HELIX_MONITOR_INTERVAL_MS', { infer: true });
    this.maxPerDay = config.get('HELIX_MONITOR_MAX_PER_DAY', { infer: true });
  }

  // ------------------------------------------------------------------ background loop

  /** True when the loop should run in this process. */
  loopEnabled(): boolean {
    return this.intervalMs > 0 && process.env.NODE_ENV !== 'test' && process.env.HELIX_DEMO !== '1';
  }

  get loopRunning(): boolean {
    return this.timer !== null;
  }

  onApplicationBootstrap() {
    if (!this.loopEnabled()) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    this.logger.log(`Monitoring loop every ${this.intervalMs}ms`);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.cycle?.catch(() => undefined);
  }

  /** One background cycle over every enabled monitor. Skipped if the previous one is still running. */
  async tick(): Promise<MonitorRunResult[] | null> {
    if (this.cycle) return null;
    this.cycle = this.runAll().catch((err: Error) => {
      this.logger.error(`Monitoring cycle failed: ${err.message}`);
      return [];
    });
    try {
      return await this.cycle;
    } finally {
      this.cycle = null;
    }
  }

  // ------------------------------------------------------------------ runs

  /** Runs every enabled monitor (of one org, or of all orgs) one after another. */
  async runAll(organizationId?: string): Promise<MonitorRunResult[]> {
    const monitors = await this.prisma.monitor.findMany({
      where: { enabled: true, ...(organizationId ? { organizationId } : {}) },
      include: { dataSource: true },
      orderBy: { createdAt: 'asc' },
    });
    const results: MonitorRunResult[] = [];
    for (const m of monitors) results.push(await this.runMonitor(m));
    return results;
  }

  /** Runs one monitor now. Never throws: problems end as status "error". */
  async runMonitor(monitor: MonitorWithSource): Promise<MonitorRunResult> {
    let result: MonitorRunResult;
    try {
      result = await this.evaluate(monitor);
    } catch (err) {
      this.logger.error(`Monitor ${monitor.id} failed: ${(err as Error).message}`);
      result = this.result(monitor, 'error', `Monitor run failed: ${(err as Error).message}`);
    }
    try {
      await this.prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: result.status,
          lastMessage: result.message.slice(0, 1000),
        },
      });
    } catch (err) {
      // e.g. deleted mid-run; the result still stands.
      this.logger.warn(`Could not update monitor ${monitor.id}: ${(err as Error).message}`);
    }
    return result;
  }

  /**
   * Read-only: asks the engine for the monitor's daily series and anomalies
   * (the same call a run makes) without opening anything or touching the
   * monitor row. Throws ServiceUnavailableException when the engine fails.
   */
  async series(monitor: MonitorWithSource): Promise<MonitorSeriesView> {
    let detected: DetectAnomaliesResponse;
    try {
      detected = await this.detect(monitor);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Anomaly detection failed: ${(err as Error).message}`,
      );
    }
    const rawSeries = detected?.metric?.series ?? [];
    const rawAnomalies = detected?.anomalies ?? [];
    const choice = chooseAnomaly(rawSeries, rawAnomalies, {
      lookbackDays: monitor.lookbackDays,
      minSeverity: monitor.minSeverity,
    });
    return {
      monitorId: monitor.id,
      monitorName: monitor.name,
      unit: monitor.unit,
      lookbackDays: monitor.lookbackDays,
      minSeverity: monitor.minSeverity,
      methodUsed: detected?.methodUsed ?? null,
      seriesEnd: choice.seriesEnd,
      series: rawSeries.map((p) => ({
        date: p.timestamp.slice(0, 10),
        value: typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null,
      })),
      anomalies: rawAnomalies
        .map((a) => toRunAnomaly({ ...a, date: a.timestamp.slice(0, 10) }))
        .sort((x, y) => x.date.localeCompare(y.date)),
      picked: choice.picked ? toRunAnomaly(choice.picked) : null,
    };
  }

  private detect(monitor: MonitorWithSource): Promise<DetectAnomaliesResponse> {
    return this.engine.detectAnomalies({
      dataset: {
        dataSourceId: monitor.dataSourceId,
        organizationId: monitor.organizationId,
        table: monitor.tableName,
      },
      timeColumn: monitor.timeColumn,
      valueColumn: monitor.valueColumn,
      aggregation: monitor.aggregation,
      filter: (monitor.filter as EngineFilter | null) ?? null,
      method: 'auto',
      metricName: monitor.name,
      unit: monitor.unit,
    });
  }

  private async evaluate(monitor: MonitorWithSource): Promise<MonitorRunResult> {
    if (monitor.dataSource.status !== DataSourceStatus.CONNECTED) {
      return this.result(
        monitor,
        'error',
        `Data source "${monitor.dataSource.name}" is ${monitor.dataSource.status}, not CONNECTED.`,
      );
    }

    let detected;
    try {
      detected = await this.detect(monitor);
    } catch (err) {
      const reason =
        err instanceof UpstreamError && err.unreachable
          ? `the analytics engine is unreachable (${err.message})`
          : `the analytics engine returned an error (${(err as Error).message})`;
      return this.result(monitor, 'error', `Anomaly detection failed: ${reason}.`);
    }

    const choice = chooseAnomaly(detected?.metric?.series ?? [], detected?.anomalies ?? [], {
      lookbackDays: monitor.lookbackDays,
      minSeverity: monitor.minSeverity,
    });
    const picked = choice.picked;
    if (!picked) {
      return this.result(
        monitor,
        'ok',
        choice.seriesEnd
          ? `No ${monitor.minSeverity}+ anomalies in the ${monitor.lookbackDays} days up to ${choice.seriesEnd}.`
          : 'The series is empty, nothing to check.',
      );
    }

    const anomaly = toRunAnomaly(picked);
    const what = `${picked.severity} ${picked.direction} on ${picked.date}`;
    const key = dedupeKey(monitor.id, picked.date, picked.direction);

    const existing = await this.prisma.investigation.findUnique({
      where: { dedupeKey: key },
      select: { id: true },
    });
    if (existing) {
      return this.result(monitor, 'deduped', `The ${what} already opened an investigation.`, {
        anomaly,
        investigationId: existing.id,
      });
    }

    const since = new Date(Date.now() - 86_400_000);
    const recent = await this.prisma.investigation.count({
      where: {
        organizationId: monitor.organizationId,
        triggerType: InvestigationTriggerType.ANOMALY_DETECTED,
        createdAt: { gte: since },
      },
    });
    if (recent >= this.maxPerDay) {
      return this.result(
        monitor,
        'rate_limited',
        `Found a ${what}, but the organization already has ${recent} autonomous ` +
          `investigation(s) in the last 24 hours (limit ${this.maxPerDay}).`,
        { anomaly },
      );
    }

    const claimed = await this.claim(key, monitor.cooldownHours);
    if (claimed === false) {
      return this.result(
        monitor,
        'deduped',
        `The ${what} is within its ${monitor.cooldownHours}h cooldown.`,
        { anomaly },
      );
    }

    const triggerContext = {
      monitorId: monitor.id,
      metricKey: monitor.metricKey,
      metricName: monitor.name,
      date: picked.date,
      direction: picked.direction,
      severity: picked.severity,
      value: picked.value,
      expectedValue: picked.expectedValue,
      deviationScore: picked.deviationScore,
      dataSourceId: monitor.dataSourceId,
      table: monitor.tableName,
    };
    const question = investigationQuestion(monitor.name, picked);

    let investigationId: string;
    try {
      const inv = await this.prisma.investigation.create({
        data: {
          organizationId: monitor.organizationId,
          projectId: monitor.projectId,
          createdByUserId: null,
          triggerType: InvestigationTriggerType.ANOMALY_DETECTED,
          question,
          monitorId: monitor.id,
          dedupeKey: key,
          triggerContext,
          events: {
            create: {
              type: 'investigation.created',
              payload: { question, trigger: triggerContext },
            },
          },
        },
      });
      investigationId = inv.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Lost a race with a concurrent run of the same monitor.
        return this.result(monitor, 'deduped', `The ${what} already opened an investigation.`, {
          anomaly,
        });
      }
      throw err;
    }

    await this.audit.record({
      action: 'monitor.investigation_opened',
      resourceType: 'monitor',
      resourceId: monitor.id,
      organizationId: monitor.organizationId,
      metadata: { investigationId, dedupeKey: key, date: picked.date, severity: picked.severity },
    });
    try {
      await this.notifications.notifyOrganization(monitor.organizationId, {
        type: 'investigation.autonomous_opened',
        title: 'Autonomous investigation opened',
        body: question,
        link: `/investigations/${investigationId}`,
      });
    } catch (err) {
      this.logger.error(`Could not notify for ${investigationId}: ${(err as Error).message}`);
    }
    this.runner.enqueue(investigationId);

    return this.result(
      monitor,
      'investigation_opened',
      `Opened an investigation for the ${what}.`,
      { anomaly, investigationId },
    );
  }

  /**
   * Redis cooldown lock. true = claimed, false = already held, null = Redis
   * unavailable (the unique dedupeKey still prevents duplicates).
   */
  private async claim(key: string, cooldownHours: number): Promise<boolean | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const res = await Promise.race([
        this.redis.set(redisDedupeKey(key), '1', 'EX', Math.max(1, cooldownHours) * 3600, 'NX'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), REDIS_TIMEOUT_MS);
        }),
      ]);
      return res === 'OK';
    } catch (err) {
      this.logger.warn(`Redis dedupe unavailable for ${key}: ${(err as Error).message}`);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private result(
    monitor: Monitor,
    status: MonitorRunStatus,
    message: string,
    extra: { anomaly?: MonitorRunAnomaly; investigationId?: string } = {},
  ): MonitorRunResult {
    return { monitorId: monitor.id, monitorName: monitor.name, status, message, ...extra };
  }
}

function toRunAnomaly(a: PickedAnomaly): MonitorRunAnomaly {
  return {
    date: a.date,
    timestamp: a.timestamp,
    direction: a.direction,
    severity: a.severity,
    value: a.value,
    expectedValue: a.expectedValue,
    deviationScore: a.deviationScore,
    detectionMethod: a.detectionMethod,
    description: a.description,
  };
}
