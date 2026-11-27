import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSourceStatus, DataSourceType } from '@helix/database';
import {
  AnalyticsEngineClient,
  DetectAnomaliesResponse,
  EngineAnomaly,
  EngineDataset,
  EngineFilter,
  EngineKpiMetric,
  EngineKpiSpec,
  ForecastResponse,
  SegmentCompareResponse,
} from '../clients/analytics-engine.client';
import { UpstreamError } from '../clients/http';
import type { SchemaColumn } from '../monitors/monitor-rules';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalyticsPlan,
  buildHeatmapCells,
  bucketThroughput,
  dayOf,
  daysEnding,
  fitBand,
  FLAG_THRESHOLD,
  flagged,
  mapSeverity,
  pickAnalyticsPlan,
  pickStoryAnomaly,
  SCORE_ALL_THRESHOLD,
  weekday,
} from './analytics-rules';
import type {
  AnalyticsSourceRef,
  Anomaly,
  AnomalyData,
  Kpi,
  Overview,
  RevenueData,
  RevenueStory,
  StorySlice,
  ThroughputDay,
} from './analytics.types';

const ANALYSABLE: DataSourceType[] = [DataSourceType.POSTGRESQL, DataSourceType.CSV];
export const CACHE_TTL_MS = 60_000;
const KPI_WINDOW_DAYS = 30;
const SERIES_DAYS = 90;
const HEATMAP_DAYS = 28;
const MAX_SEGMENTS = 8;

interface MetricDef {
  key: string;
  label: string;
  aggregation: 'sum' | 'count' | 'count_distinct';
  valueColumn: string | null;
  filter: EngineFilter | null;
  unit: string | null;
}

/** Everything the four endpoints need, computed once per org and cached. */
export interface AnalyticsBundle {
  overview: Overview;
  revenue: RevenueData;
  anomalies: AnomalyData;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const columnsOf = (columns: unknown): SchemaColumn[] =>
  Array.isArray(columns)
    ? columns.filter(
        (c): c is SchemaColumn =>
          !!c && typeof c === 'object' && typeof (c as SchemaColumn).name === 'string',
      )
    : [];

/**
 * Real, tenant-scoped dashboard analytics. Picks the organization's first
 * connected CSV/Postgres orders-like table and computes everything through
 * the analytics engine (KPIs, anomaly scores, forecast, segment compare).
 * Results are cached per organization for 60 seconds.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly cache = new Map<string, { expires: number; value: Promise<AnalyticsBundle> }>();
  private readonly throughputCache = new Map<
    string,
    { expires: number; value: Promise<ThroughputDay[]> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AnalyticsEngineClient,
  ) {}

  async overview(organizationId: string): Promise<Overview> {
    return (await this.bundle(organizationId)).overview;
  }

  async revenue(organizationId: string): Promise<RevenueData> {
    return (await this.bundle(organizationId)).revenue;
  }

  async anomalies(organizationId: string): Promise<AnomalyData> {
    return (await this.bundle(organizationId)).anomalies;
  }

  throughput(organizationId: string, now = new Date()): Promise<ThroughputDay[]> {
    return this.cached(this.throughputCache, organizationId, async () => {
      const since = new Date(now.getTime() - 14 * 86_400_000);
      const rows = await this.prisma.investigation.findMany({
        where: { organizationId, createdAt: { gte: since } },
        select: { createdAt: true, triggerType: true },
      });
      return bucketThroughput(rows, now);
    });
  }

  /** Drops cached results (all orgs, or one). */
  invalidate(organizationId?: string) {
    if (organizationId) {
      this.cache.delete(organizationId);
      this.throughputCache.delete(organizationId);
    } else {
      this.cache.clear();
      this.throughputCache.clear();
    }
  }

  private async cached<T>(
    store: Map<string, { expires: number; value: Promise<T> }>,
    key: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = compute();
    store.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
    // Never cache failures (including "no usable source", so connecting one shows up at once).
    value.catch(() => {
      if (store.get(key)?.value === value) store.delete(key);
    });
    return value;
  }

  private bundle(organizationId: string): Promise<AnalyticsBundle> {
    return this.cached(this.cache, organizationId, () => this.compute(organizationId));
  }

  private async plan(organizationId: string): Promise<AnalyticsPlan | null> {
    const sources = await this.prisma.dataSource.findMany({
      where: { organizationId, status: DataSourceStatus.CONNECTED, type: { in: ANALYSABLE } },
      include: { schemas: { orderBy: { tableName: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return pickAnalyticsPlan(
      sources.map((ds) => ({
        id: ds.id,
        name: ds.name,
        schemas: ds.schemas.map((s) => ({ tableName: s.tableName, columns: columnsOf(s.columns) })),
      })),
    );
  }

  private async compute(organizationId: string): Promise<AnalyticsBundle> {
    const plan = await this.plan(organizationId);
    if (!plan) {
      throw new NotFoundException(
        'No connected CSV or Postgres data source with an orders-like table (a date and an amount column)',
      );
    }
    try {
      return await this.computeFor(organizationId, plan);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.logger.warn(`analytics engine failed for org ${organizationId}: ${err.message}`);
        throw new ServiceUnavailableException(`Analytics engine unavailable: ${err.message}`);
      }
      throw err;
    }
  }

  private async computeFor(organizationId: string, plan: AnalyticsPlan): Promise<AnalyticsBundle> {
    const dataset: EngineDataset = {
      dataSourceId: plan.source.id,
      organizationId,
      table: plan.table,
    };
    const metrics: MetricDef[] = [
      {
        key: 'revenue',
        label: 'Revenue',
        aggregation: 'sum',
        valueColumn: plan.money,
        filter: null,
        unit: 'USD',
      },
      { key: 'orders', label: 'Orders', aggregation: 'count', valueColumn: null, filter: null, unit: null },
    ];
    if (plan.refundFilter) {
      metrics.push({
        key: 'refunds',
        label: 'Refunds',
        aggregation: 'count',
        valueColumn: null,
        filter: plan.refundFilter,
        unit: null,
      });
    }
    if (plan.customer) {
      metrics.push({
        key: 'customers',
        label: 'Active customers',
        aggregation: 'count_distinct',
        valueColumn: plan.customer,
        filter: null,
        unit: null,
      });
    }

    const detect = (m: MetricDef) =>
      this.engine.detectAnomalies({
        dataset,
        timeColumn: plan.time,
        valueColumn: m.valueColumn,
        aggregation: m.aggregation,
        filter: m.filter,
        method: 'auto',
        metricName: `Daily ${m.label.toLowerCase()}`,
        unit: m.unit,
        threshold: SCORE_ALL_THRESHOLD,
      } as Parameters<AnalyticsEngineClient['detectAnomalies']>[0]);

    const kpiSpecs: EngineKpiSpec[] = [
      { name: 'revenue', aggregation: 'sum', column: plan.money, unit: 'USD' },
      { name: 'orders', aggregation: 'count' },
      {
        name: 'aov',
        aggregation: 'ratio',
        unit: 'USD',
        numerator: { aggregation: 'sum', column: plan.money },
        denominator: { aggregation: 'count' },
      },
    ];
    if (plan.refundFilter) {
      kpiSpecs.push({
        name: 'refund_rate',
        aggregation: 'ratio',
        numerator: { aggregation: 'count', filter: plan.refundFilter },
        denominator: { aggregation: 'count' },
      });
    }

    // Stage 1: revenue scores are required; the other metrics are best-effort.
    const [revenueDet, ...otherDets] = await Promise.all([
      detect(metrics[0]!),
      ...metrics.slice(1).map((m) => detect(m).catch((e) => this.soft('detect', m.key, e))),
    ]);
    const seriesEnd = this.seriesEnd(revenueDet);
    if (!seriesEnd) throw new NotFoundException('The orders table has no dated rows');

    const revenueFlagged = flagged(revenueDet.anomalies);
    const storyAnomaly = pickStoryAnomaly(revenueFlagged);
    const [kpiRes, forecast, compare] = await Promise.all([
      this.engine.kpis({
        dataset,
        timeColumn: plan.time,
        kpis: kpiSpecs,
        windowDays: KPI_WINDOW_DAYS,
        asOf: seriesEnd,
      }),
      this.engine
        .forecast({
          dataset,
          timeColumn: plan.time,
          valueColumn: plan.money,
          aggregation: 'sum',
          horizon: 14,
          method: 'auto',
        })
        .catch((e) => this.soft('forecast', 'revenue', e)),
      storyAnomaly
        ? this.engine
            .compareSegments({
              dataset,
              timeColumn: plan.time,
              valueColumn: plan.money,
              aggregation: 'sum',
              targetDate: dayOf(storyAnomaly.timestamp),
              baseline: 'same_weekday',
              baselinePeriods: 4,
              metricName: 'Daily revenue',
            })
            .catch((e) => this.soft('segments', 'revenue', e))
        : Promise.resolve(null),
    ]);

    // Stage 2: revenue per segment value (current vs previous 30 days).
    const segmentColumn =
      plan.segmentColumn ?? compare?.topSlice?.column ?? compare?.dimensions[0]?.column ?? null;
    const segmentValues = this.segmentValues(compare, segmentColumn);
    const segmentKpis =
      segmentColumn && segmentValues.length
        ? await this.engine
            .kpis({
              dataset,
              timeColumn: plan.time,
              windowDays: KPI_WINDOW_DAYS,
              asOf: seriesEnd,
              kpis: segmentValues.map((v) => ({
                name: v,
                aggregation: 'sum',
                column: plan.money,
                filter: { column: segmentColumn, op: 'eq', value: v },
                unit: 'USD',
              })),
            })
            .catch((e) => this.soft('kpis', 'segments', e))
        : null;

    const source: AnalyticsSourceRef = {
      dataSourceId: plan.source.id,
      dataSourceName: plan.source.name,
      table: plan.table,
      timeColumn: plan.time,
      valueColumn: plan.money,
      seriesEnd,
    };
    const generatedAt = new Date().toISOString();
    const detections = [revenueDet, ...otherDets];

    return {
      overview: this.buildOverview(kpiRes.metrics, generatedAt, source),
      revenue: this.buildRevenue(revenueDet, forecast, compare, storyAnomaly, segmentColumn, segmentKpis?.metrics ?? null, source),
      anomalies: this.buildAnomalies(metrics, detections, compare, seriesEnd, source),
    };
  }

  private soft(what: string, key: string, err: unknown): null {
    this.logger.warn(`analytics ${what} (${key}) skipped: ${(err as Error).message}`);
    return null;
  }

  private seriesEnd(det: DetectAnomaliesResponse): string | null {
    const days = det.metric.series.filter((p) => p.value !== null).map((p) => dayOf(p.timestamp));
    return days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
  }

  private segmentValues(compare: SegmentCompareResponse | null, column: string | null): string[] {
    if (!compare || !column) return [];
    const dim = compare.dimensions.find((d) => d.column === column);
    return (dim?.slices ?? [])
      .map((s) => s.value)
      .filter((v) => v !== '' && v !== null && v !== undefined)
      .slice(0, MAX_SEGMENTS);
  }

  private buildOverview(
    metrics: EngineKpiMetric[],
    generatedAt: string,
    source: AnalyticsSourceRef,
  ): Overview {
    const LABELS: Record<string, { label: string; unit: Kpi['unit'] }> = {
      revenue: { label: `Revenue (${KPI_WINDOW_DAYS}d)`, unit: 'currency' },
      orders: { label: `Orders (${KPI_WINDOW_DAYS}d)`, unit: 'count' },
      aov: { label: 'Average order value', unit: 'currency' },
      refund_rate: { label: 'Refund rate', unit: 'percent' },
    };
    const kpis: Kpi[] = [];
    for (const m of metrics) {
      const meta = LABELS[m.name];
      if (!meta || m.value === null) continue;
      const current = m.series.filter((p) => dayOf(p.timestamp) >= m.window.currentStart);
      const ratio = m.name === 'aov' || m.name === 'refund_rate';
      const usable = ratio ? current.filter((p) => p.value !== null) : current;
      kpis.push({
        key: m.name,
        label: meta.label,
        value: meta.unit === 'percent' ? round4(m.value) : meta.unit === 'count' ? m.value : round2(m.value),
        unit: meta.unit,
        delta: m.changePercent === null ? 0 : m.changePercent / 100,
        spark: usable.map((p) => (meta.unit === 'percent' ? round4(p.value ?? 0) : round2(p.value ?? 0))),
        previous: m.baseline,
        sparkDays: usable.map((p) => dayOf(p.timestamp)),
      });
    }
    return { generatedAt, kpis, source, window: metrics[0]?.window };
  }

  private buildRevenue(
    det: DetectAnomaliesResponse,
    forecast: ForecastResponse | null,
    compare: SegmentCompareResponse | null,
    storyAnomaly: EngineAnomaly | null,
    segmentColumn: string | null,
    segmentMetrics: EngineKpiMetric[] | null,
    source: AnalyticsSourceRef,
  ): RevenueData {
    const band = fitBand(det.metric.series, det.anomalies, FLAG_THRESHOLD);
    const series = band.points.slice(-SERIES_DAYS);

    const bySegment = (segmentMetrics ?? [])
      .filter((m) => m.value !== null)
      .map((m) => ({ segment: m.name, current: round2(m.value ?? 0), previous: round2(m.baseline ?? 0) }))
      .sort((a, b) => b.current - a.current);
    const total = bySegment.reduce((t, s) => t + s.current, 0);
    const channelMix = total
      ? bySegment.map((s) => ({ channel: s.segment, share: Math.round((s.current / total) * 10_000) / 10_000 }))
      : [];
    const channelSeries = (segmentMetrics ?? []).map((m) => ({
      channel: m.name,
      points: m.series.map((p) => ({ date: dayOf(p.timestamp), value: round2(p.value ?? 0) })),
    }));

    return {
      series,
      bySegment,
      channelMix,
      bandMethod:
        `Expected = the anomaly detector's expected value for each day (${det.methodUsed}: ` +
        `trend plus weekly pattern); band = expected +/- ${FLAG_THRESHOLD} robust standard ` +
        `deviations of the residual (sigma ${Math.round(band.sigma)}), the range the detector ` +
        'treats as normal. Fitted in-sample, not a backtest forecast.',
      detectionMethod: det.methodUsed,
      projection: forecast?.forecast.map((p) => ({
        date: dayOf(p.timestamp),
        value: round2(p.value),
        lower: round2(Math.max(0, p.lower)),
        upper: round2(p.upper),
      })),
      projectionMethod: forecast?.computationMethod,
      projectionMape: forecast?.backtest.mape ?? null,
      segmentColumn,
      channelSeries,
      story: this.buildStory(storyAnomaly, compare),
      source,
    };
  }

  private buildStory(a: EngineAnomaly | null, compare: SegmentCompareResponse | null): RevenueStory | null {
    if (!a) return null;
    const date = dayOf(a.timestamp);
    const slice = (s: {
      value: string;
      actual: number;
      expected: number;
      delta: number;
      deltaPercent: number | null;
      shareOfDelta: number;
    }): StorySlice => ({
      value: s.value,
      actual: round2(s.actual),
      expected: round2(s.expected),
      delta: round2(s.delta),
      deltaPercent: s.deltaPercent === null ? null : round2(s.deltaPercent),
      shareOfDelta: Math.round(s.shareOfDelta * 10_000) / 10_000,
    });
    const top = compare?.topSlice ?? null;
    const dim = top
      ? compare!.dimensions.find((d) => d.column === top.column)
      : [...(compare?.dimensions ?? [])].sort((x, y) => y.concentration - x.concentration)[0];
    const deltaPct =
      compare?.total.deltaPercent ??
      (a.expectedValue ? ((a.value - a.expectedValue) / Math.abs(a.expectedValue)) * 100 : null);
    return {
      date,
      weekday: weekday(date),
      direction: a.direction,
      severity: mapSeverity(a.severity) ?? 'warning',
      zScore: round2(a.deviationScore),
      actual: round2(compare?.total.actual ?? a.value),
      expected: round2(compare?.total.expected ?? a.expectedValue),
      delta: round2(compare?.total.delta ?? a.value - a.expectedValue),
      deltaPercent: deltaPct === null ? null : round2(deltaPct),
      dimension: dim?.column ?? null,
      slices: (dim?.slices ?? []).map(slice),
      topSlice: top ? { ...slice(top), column: top.column } : null,
      baselineMethod: compare
        ? 'Expected per slice = mean of the same weekday over the previous 4 weeks'
        : "Expected = the anomaly detector's expected value",
    };
  }

  private buildAnomalies(
    metrics: MetricDef[],
    detections: (DetectAnomaliesResponse | null)[],
    compare: SegmentCompareResponse | null,
    seriesEnd: string,
    source: AnalyticsSourceRef,
  ): AnomalyData {
    const rows = metrics
      .map((m, i) => ({ m, det: detections[i] ?? null }))
      .filter((r): r is { m: MetricDef; det: DetectAnomaliesResponse } => r.det !== null);
    const items: Anomaly[] = [];
    for (const { m, det } of rows) {
      for (const a of flagged(det.anomalies)) {
        const date = dayOf(a.timestamp);
        const top =
          m.key === 'revenue' && compare?.targetDate === date && compare.topSlice
            ? `${compare.topSlice.column}: ${compare.topSlice.value}`
            : null;
        items.push({
          id: `${m.key}-${date}`,
          metric: `Daily ${m.label.toLowerCase()}`,
          severity: mapSeverity(a.severity)!,
          zScore: round2(a.deviationScore),
          change: a.expectedValue ? round4((a.value - a.expectedValue) / Math.abs(a.expectedValue)) : 0,
          detectedAt: a.timestamp,
          segment: top ?? `All ${source.table}`,
          date,
          metricKey: m.key,
          value: round2(a.value),
          expectedValue: round2(a.expectedValue),
          direction: a.direction,
          description: a.description,
        });
      }
    }
    const rank = { critical: 3, serious: 2, warning: 1 } as const;
    items.sort(
      (x, y) =>
        (y.date ?? '').localeCompare(x.date ?? '') || rank[y.severity] - rank[x.severity],
    );
    const days = daysEnding(seriesEnd, HEATMAP_DAYS);
    return {
      items,
      heatmap: {
        metrics: rows.map((r) => r.m.label),
        metricKeys: rows.map((r) => r.m.key),
        days,
        cells: buildHeatmapCells(rows.map((r) => ({ scored: r.det.anomalies })), days),
      },
      threshold: FLAG_THRESHOLD,
      source,
    };
  }
}
