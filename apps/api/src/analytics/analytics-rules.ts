import type { EngineAnomaly, EngineFilter } from '../clients/analytics-engine.client';
import {
  pickCurrencyColumn,
  pickCustomerColumn,
  pickRefundFilter,
  pickTimeColumn,
  SchemaColumn,
  weekday,
} from '../monitors/monitor-rules';
import type { RevenuePoint, Severity, ThroughputDay } from './analytics.types';

/**
 * Pure dashboard analytics rules: which table to analyse, how the expected
 * band is fitted from the detector's output, severity mapping, heatmap and
 * throughput bucketing. No I/O so it is unit-testable.
 */

/** The anomaly detector's default flag threshold (|robust z| >= 3). */
export const FLAG_THRESHOLD = 3;
/** Tiny threshold so the detector returns a score and expected value for (nearly) every day. */
export const SCORE_ALL_THRESHOLD = 1e-6;

export interface AnalyticsPlan {
  source: { id: string; name: string };
  table: string;
  time: string;
  money: string;
  refundFilter: EngineFilter | null;
  customer: string | null;
  /** Categorical column to split revenue by (channel first). */
  segmentColumn: string | null;
}

// Preference order for the split dimension: channel-like first.
const SEGMENT_NAMES = ['channel', 'source', 'platform', 'device', 'region', 'market', 'segment'];

export function pickSegmentColumn(
  cols: SchemaColumn[],
  exclude: (string | null | undefined)[],
): string | null {
  const skip = new Set(exclude.filter(Boolean).map((c) => c!.toLowerCase()));
  const candidates = cols.filter((c) => {
    const sem = (c.semanticType ?? '').toLowerCase();
    const type = (c.type ?? '').toLowerCase();
    if (skip.has(c.name.toLowerCase())) return false;
    if (c.name.toLowerCase().endsWith('id')) return false;
    return sem === 'categorical' || (!sem && (type.includes('text') || type.includes('char')));
  });
  for (const word of SEGMENT_NAMES) {
    const hit = candidates.find((c) => c.name.toLowerCase().includes(word));
    if (hit) return hit.name;
  }
  return null;
}

/**
 * First orders-like table (a datetime column plus a money column) of the
 * first eligible source, with the same column heuristics as monitor
 * suggestions. Tables whose name mentions orders win within a source.
 */
export function pickAnalyticsPlan(
  sources: { id: string; name: string; schemas: { tableName: string; columns: SchemaColumn[] }[] }[],
): AnalyticsPlan | null {
  for (const ds of sources) {
    const tables = [...ds.schemas].sort(
      (a, b) =>
        Number(/order/i.test(b.tableName)) - Number(/order/i.test(a.tableName)) ||
        a.tableName.localeCompare(b.tableName),
    );
    for (const t of tables) {
      const time = pickTimeColumn(t.columns);
      const money = pickCurrencyColumn(t.columns);
      if (!time || !money) continue;
      const refundFilter = pickRefundFilter(t.columns);
      const customer = pickCustomerColumn(t.columns)?.name ?? null;
      return {
        source: { id: ds.id, name: ds.name },
        table: t.tableName,
        time: time.name,
        money: money.name,
        refundFilter,
        customer,
        segmentColumn: pickSegmentColumn(t.columns, [time.name, money.name, refundFilter?.column]),
      };
    }
  }
  return null;
}

export const dayOf = (timestamp: string) => timestamp.slice(0, 10);

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** `n` consecutive days ending at `end` (inclusive), oldest first. */
export const daysEnding = (end: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));

export function mapSeverity(s: EngineAnomaly['severity']): Severity | null {
  if (s === 'CRITICAL') return 'critical';
  if (s === 'HIGH') return 'serious';
  if (s === 'MEDIUM') return 'warning';
  return null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface FittedBand {
  points: RevenuePoint[];
  /** Residual offset and robust sigma from regressing residual on score. */
  offset: number;
  sigma: number;
}

/**
 * Expected band per day from the anomaly detector run with a near-zero
 * threshold (so every day comes back with expectedValue and deviationScore).
 * The detector scores residual r = value - expected as (r - c) / s; we
 * recover c and s by least squares over (score, r) pairs, then
 * band = expected + c +/- threshold * s: exactly the range the detector
 * treats as normal. Days without a score (score 0) get expected = value - c.
 */
export function fitBand(
  series: { timestamp: string; value: number | null }[],
  scored: EngineAnomaly[],
  threshold = FLAG_THRESHOLD,
): FittedBand {
  const byDay = new Map(scored.map((a) => [dayOf(a.timestamp), a]));
  const pairs = scored
    .filter((a) => Number.isFinite(a.deviationScore) && Number.isFinite(a.expectedValue))
    .map((a) => ({ x: a.deviationScore, y: a.value - a.expectedValue }));
  let offset = 0;
  let sigma = 0;
  if (pairs.length >= 2) {
    const mx = pairs.reduce((t, p) => t + p.x, 0) / pairs.length;
    const my = pairs.reduce((t, p) => t + p.y, 0) / pairs.length;
    const sxx = pairs.reduce((t, p) => t + (p.x - mx) ** 2, 0);
    const sxy = pairs.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0);
    sigma = sxx > 0 ? Math.abs(sxy / sxx) : 0;
    offset = my - (sxx > 0 ? sxy / sxx : 0) * mx;
  }
  const points: RevenuePoint[] = [];
  for (const p of series) {
    if (p.value === null || !Number.isFinite(p.value)) continue;
    const date = dayOf(p.timestamp);
    const a = byDay.get(date);
    const expected = a ? a.expectedValue : p.value - offset;
    const centre = expected + offset;
    const z = a ? a.deviationScore : 0;
    points.push({
      date,
      revenue: round2(p.value),
      forecast: round2(centre),
      lower: round2(Math.max(0, centre - threshold * sigma)),
      upper: round2(centre + threshold * sigma),
      isAnomaly: Math.abs(z) >= threshold && !!a && mapSeverity(a.severity) !== null,
      zScore: a ? round2(z) : 0,
    });
  }
  return { points, offset, sigma };
}

/** Flagged anomalies only (|score| >= threshold and a severity we show). */
export const flagged = (scored: EngineAnomaly[], threshold = FLAG_THRESHOLD) =>
  scored.filter((a) => Math.abs(a.deviationScore) >= threshold && mapSeverity(a.severity));

/**
 * The anomaly the dashboard story is about: the most severe drop (largest
 * |score|), most recent on ties; any flagged spike when there are no drops.
 */
export function pickStoryAnomaly(anoms: EngineAnomaly[]): EngineAnomaly | null {
  const sorted = [...anoms].sort(
    (a, b) =>
      Math.abs(b.deviationScore) - Math.abs(a.deviationScore) ||
      b.timestamp.localeCompare(a.timestamp),
  );
  return sorted.find((a) => a.direction === 'drop') ?? sorted[0] ?? null;
}

/** |score| per metric per day; 0 where the detector returned nothing. */
export function buildHeatmapCells(
  rows: { scored: EngineAnomaly[] }[],
  days: string[],
): number[][] {
  return rows.map((r) => {
    const byDay = new Map(r.scored.map((a) => [dayOf(a.timestamp), a.deviationScore]));
    return days.map((d) => round2(Math.abs(byDay.get(d) ?? 0)));
  });
}

export { weekday };

/** Investigations created per UTC day by trigger, for the 14 days ending `today`. */
export function bucketThroughput(
  rows: { createdAt: Date; triggerType: string }[],
  today: Date,
  days = 14,
): ThroughputDay[] {
  const end = today.toISOString().slice(0, 10);
  const out = daysEnding(end, days).map((date) => ({ date, anomaly: 0, question: 0, scheduled: 0 }));
  const index = new Map(out.map((d, i) => [d.date, i]));
  for (const r of rows) {
    const i = index.get(r.createdAt.toISOString().slice(0, 10));
    if (i === undefined) continue;
    const day = out[i]!;
    if (r.triggerType === 'ANOMALY_DETECTED') day.anomaly += 1;
    else if (r.triggerType === 'SCHEDULED') day.scheduled += 1;
    else day.question += 1;
  }
  return out;
}
