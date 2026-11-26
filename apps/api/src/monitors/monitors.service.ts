import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AnomalySeverity,
  DataSourceStatus,
  DataSourceType,
  InvestigationStatus,
  Prisma,
} from '@helix/database';
import type { EngineFilter } from '../clients/analytics-engine.client';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService, MonitorRunResult } from './monitoring.service';
import { MonitorSuggestion, SchemaColumn, suggestForTable } from './monitor-rules';

export const AGGREGATIONS = ['sum', 'mean', 'count', 'count_distinct'] as const;

export interface CreateMonitorInput {
  name: string;
  projectId: string;
  dataSourceId: string;
  metricKey: string;
  tableName: string;
  timeColumn: string;
  valueColumn?: string | null;
  aggregation: (typeof AGGREGATIONS)[number];
  filter?: EngineFilter | null;
  unit?: string | null;
  minSeverity?: AnomalySeverity;
  lookbackDays?: number;
  cooldownHours?: number;
  enabled?: boolean;
}

export interface UpdateMonitorInput {
  name?: string;
  enabled?: boolean;
  minSeverity?: AnomalySeverity;
  lookbackDays?: number;
  cooldownHours?: number;
}

export interface MonitorView {
  id: string;
  projectId: string;
  dataSourceId: string;
  dataSource: { id: string; name: string };
  name: string;
  metricKey: string;
  tableName: string;
  timeColumn: string;
  valueColumn: string | null;
  aggregation: string;
  filter: unknown;
  unit: string | null;
  minSeverity: AnomalySeverity;
  lookbackDays: number;
  cooldownHours: number;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastMessage: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  investigationsCount: number;
  latestInvestigation: { id: string; status: InvestigationStatus; createdAt: Date } | null;
}

export interface AnomalyView {
  id: string;
  description: string;
  severity: AnomalySeverity;
  detectedAt: Date;
  detectionMethod: string;
  value: number;
  expectedValue: number | null;
  deviationScore: number | null;
  metricId: string | null;
  metricName: string | null;
  unit: string | null;
  dataSource: { id: string; name: string } | null;
  /** The investigation whose evidence references this anomaly, when there is one. */
  investigationId: string | null;
  createdAt: Date;
}

/** Tabular sources monitors can watch (MCP/GITHUB feeds are event logs, not metrics). */
const MONITORABLE: DataSourceType[] = [DataSourceType.POSTGRESQL, DataSourceType.CSV];

const monitorInclude = {
  dataSource: { select: { id: true, name: true } },
  _count: { select: { investigations: true } },
  investigations: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
} satisfies Prisma.MonitorInclude;
type MonitorRow = Prisma.MonitorGetPayload<{ include: typeof monitorInclude }>;

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
  ) {}

  async list(organizationId: string): Promise<MonitorView[]> {
    const rows = await this.prisma.monitor.findMany({
      where: { organizationId },
      include: monitorInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async get(organizationId: string, id: string): Promise<MonitorView> {
    const row = await this.prisma.monitor.findFirst({
      where: { id, organizationId },
      include: monitorInclude,
    });
    if (!row) throw new NotFoundException('Monitor not found');
    return toView(row);
  }

  /** Revenue/orders/refunds/active-customer monitors for every CONNECTED tabular table not yet watched. */
  async suggestions(organizationId: string): Promise<MonitorSuggestion[]> {
    const [sources, existing] = await Promise.all([
      this.prisma.dataSource.findMany({
        where: { organizationId, status: DataSourceStatus.CONNECTED, type: { in: MONITORABLE } },
        include: { schemas: { orderBy: { tableName: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.monitor.findMany({
        where: { organizationId },
        select: { dataSourceId: true, tableName: true, metricKey: true },
      }),
    ]);
    const taken = new Set(existing.map((m) => `${m.dataSourceId}|${m.tableName}|${m.metricKey}`));
    return sources.flatMap((ds) =>
      ds.schemas.flatMap((s) =>
        suggestForTable(ds, { tableName: s.tableName, columns: columnsOf(s.columns) }).filter(
          (sug) => !taken.has(`${sug.dataSourceId}|${sug.tableName}|${sug.metricKey}`),
        ),
      ),
    );
  }

  async create(
    organizationId: string,
    userId: string,
    input: CreateMonitorInput,
  ): Promise<MonitorView> {
    const [project, ds] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: input.projectId, organizationId },
        select: { id: true },
      }),
      this.prisma.dataSource.findFirst({
        where: { id: input.dataSourceId, organizationId },
        include: { schemas: true },
      }),
    ]);
    if (!project) throw new NotFoundException('Project not found');
    if (!ds) throw new NotFoundException('Data source not found');

    const table = ds.schemas.find((s) => s.tableName === input.tableName);
    if (!table) {
      throw invalid('tableName', `Table "${input.tableName}" is not in data source "${ds.name}"`);
    }
    const names = new Set(columnsOf(table.columns).map((c) => c.name));
    const missing = (path: string, col: string | null | undefined) =>
      col && !names.has(col)
        ? { path, message: `Column "${col}" is not in "${table.tableName}"` }
        : null;
    const issues = [
      missing('timeColumn', input.timeColumn),
      missing('valueColumn', input.valueColumn),
      missing('filter.column', input.filter?.column),
    ].filter((i): i is { path: string; message: string } => i !== null);
    if (input.aggregation !== 'count' && !input.valueColumn) {
      issues.push({
        path: 'valueColumn',
        message: `Required for aggregation "${input.aggregation}"`,
      });
    }
    if (issues.length) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', issues });
    }

    const row = await this.prisma.monitor.create({
      data: {
        organizationId,
        projectId: project.id,
        dataSourceId: ds.id,
        name: input.name,
        metricKey: input.metricKey,
        tableName: input.tableName,
        timeColumn: input.timeColumn,
        valueColumn: input.valueColumn ?? null,
        aggregation: input.aggregation,
        filter: input.filter ? (input.filter as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
        unit: input.unit ?? null,
        ...(input.minSeverity ? { minSeverity: input.minSeverity } : {}),
        ...(input.lookbackDays !== undefined ? { lookbackDays: input.lookbackDays } : {}),
        ...(input.cooldownHours !== undefined ? { cooldownHours: input.cooldownHours } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        createdByUserId: userId,
      },
      include: monitorInclude,
    });
    return toView(row);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateMonitorInput,
  ): Promise<MonitorView> {
    await this.findOwned(organizationId, id);
    const row = await this.prisma.monitor.update({
      where: { id },
      data: input,
      include: monitorInclude,
    });
    return toView(row);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.findOwned(organizationId, id);
    await this.prisma.monitor.delete({ where: { id } });
  }

  /** Runs one monitor now (enabled or not: an explicit request). */
  async run(organizationId: string, id: string): Promise<MonitorRunResult> {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id, organizationId },
      include: { dataSource: true },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    return this.monitoring.runMonitor(monitor);
  }

  runAll(organizationId: string): Promise<MonitorRunResult[]> {
    return this.monitoring.runAll(organizationId);
  }

  /** Recent Anomaly rows, newest first, with metric name and the investigation that found them. */
  async anomalies(organizationId: string, limit: number): Promise<AnomalyView[]> {
    const fetched = await this.prisma.anomaly.findMany({
      where: { organizationId },
      include: {
        metric: { select: { name: true, unit: true } },
        dataSource: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { detectedAt: 'desc' }],
      // Every investigation stores its own copy of the anomalies it found, so
      // over-fetch and keep only the newest copy of each distinct anomaly.
      take: limit * 5,
    });
    const seen = new Set<string>();
    const rows = fetched
      .filter((r) => {
        const key = [r.dataSourceId, r.detectedAt.toISOString(), r.description].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
    const ids = rows.map((r) => r.id);
    // Anomaly rows carry no investigation id; the agents' evidence does (data.anomalyId).
    const links = ids.length
      ? await this.prisma.$queryRaw<{ anomalyId: string; investigationId: string }[]>(Prisma.sql`
          SELECT DISTINCT ON (e."data"->>'anomalyId')
                 e."data"->>'anomalyId' AS "anomalyId", e."investigationId"
          FROM "evidence" e
          JOIN "investigations" i ON i."id" = e."investigationId"
          WHERE i."organizationId" = ${organizationId}
            AND e."data"->>'anomalyId' IN (${Prisma.join(ids)})
          ORDER BY e."data"->>'anomalyId', e."createdAt" ASC`)
      : [];
    const byAnomaly = new Map(links.map((l) => [l.anomalyId, l.investigationId]));
    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      severity: r.severity,
      detectedAt: r.detectedAt,
      detectionMethod: r.detectionMethod,
      value: r.value,
      expectedValue: r.expectedValue,
      deviationScore: r.deviationScore,
      metricId: r.metricId,
      metricName: r.metric?.name ?? null,
      unit: r.metric?.unit ?? null,
      dataSource: r.dataSource,
      investigationId: byAnomaly.get(r.id) ?? null,
      createdAt: r.createdAt,
    }));
  }

  private async findOwned(organizationId: string, id: string) {
    const m = await this.prisma.monitor.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!m) throw new NotFoundException('Monitor not found');
    return m;
  }
}

function invalid(path: string, message: string) {
  return new BadRequestException({
    statusCode: 400,
    message: 'Validation failed',
    issues: [{ path, message }],
  });
}

function columnsOf(columns: unknown): SchemaColumn[] {
  if (!Array.isArray(columns)) return [];
  return columns.filter(
    (c): c is SchemaColumn =>
      !!c && typeof c === 'object' && typeof (c as SchemaColumn).name === 'string',
  );
}

function toView(row: MonitorRow): MonitorView {
  const { _count, investigations, ...m } = row;
  return {
    id: m.id,
    projectId: m.projectId,
    dataSourceId: m.dataSourceId,
    dataSource: m.dataSource,
    name: m.name,
    metricKey: m.metricKey,
    tableName: m.tableName,
    timeColumn: m.timeColumn,
    valueColumn: m.valueColumn,
    aggregation: m.aggregation,
    filter: m.filter,
    unit: m.unit,
    minSeverity: m.minSeverity,
    lookbackDays: m.lookbackDays,
    cooldownHours: m.cooldownHours,
    enabled: m.enabled,
    lastRunAt: m.lastRunAt,
    lastStatus: m.lastStatus,
    lastMessage: m.lastMessage,
    createdByUserId: m.createdByUserId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    investigationsCount: _count.investigations,
    latestInvestigation: investigations[0] ?? null,
  };
}
