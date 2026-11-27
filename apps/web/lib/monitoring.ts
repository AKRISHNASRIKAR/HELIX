import type { Investigation } from '@helix/contracts';
import type { AnomalyRecord, Monitor, MonitorAnomaly, MonitorSuggestion } from './api';

/** Pure helpers for the monitoring page (tested in lib/monitoring.test.ts). */

const STATUS_LABEL: Record<string, string> = {
  ok: 'No anomaly',
  anomaly: 'Anomaly found',
  investigation_opened: 'Investigation opened',
  deduped: 'Already investigated',
  rate_limited: 'Rate limited',
  error: 'Error',
};

export function monitorStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Never run';
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

export type MonitorTone = 'good' | 'warn' | 'bad' | 'info' | 'muted';

export function monitorStatusTone(status: string | null | undefined): MonitorTone {
  switch (status) {
    case 'ok':
      return 'good';
    case 'anomaly':
    case 'investigation_opened':
      return 'warn';
    case 'error':
      return 'bad';
    case 'deduped':
    case 'rate_limited':
      return 'info';
    default:
      return 'muted';
  }
}

/** "sum(amount)", "count(*)", "count_distinct(customer_id)". */
export function describeAggregation(m: Pick<Monitor, 'aggregation' | 'valueColumn'>): string {
  return `${m.aggregation}(${m.valueColumn ?? '*'})`;
}

export function isAutonomous(inv: Pick<Investigation, 'triggerType'>): boolean {
  return String(inv.triggerType) === 'ANOMALY_DETECTED';
}

/** ANOMALY_DETECTED investigations, newest first. */
export function autonomousInvestigations<T extends Pick<Investigation, 'triggerType' | 'createdAt'>>(list: T[]): T[] {
  return list
    .filter(isAutonomous)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Stable key used to post a suggestion back as a new monitor. */
export function suggestionKey(s: Pick<MonitorSuggestion, 'dataSourceId' | 'tableName' | 'metricKey'>): string {
  return `${s.dataSourceId}:${s.tableName}:${s.metricKey}`;
}

/** Percent change of an anomaly vs its expected value, or null. */
export function anomalyChange(a: Pick<AnomalyRecord, 'value' | 'expectedValue'>): number | null {
  if (a.expectedValue == null || a.expectedValue === 0 || !Number.isFinite(a.value)) return null;
  return (a.value - a.expectedValue) / Math.abs(a.expectedValue);
}

export function anomalyMetricName(a: AnomalyRecord): string {
  return a.metricName ?? a.metric?.name ?? a.description;
}

export interface MonitoringSummary {
  total: number;
  enabled: number;
  lastRunAt: string | null;
  withAnomaly: number;
}

export function summarizeMonitors(monitors: Monitor[]): MonitoringSummary {
  const runs = monitors.map((m) => m.lastRunAt).filter((v): v is string => !!v).sort();
  return {
    total: monitors.length,
    enabled: monitors.filter((m) => m.enabled).length,
    lastRunAt: runs[runs.length - 1] ?? null,
    withAnomaly: monitors.filter((m) => m.lastStatus === 'anomaly' || m.lastStatus === 'investigation_opened').length,
  };
}

// ------------------------------------------------------------ visual helpers

export interface SeverityMeta {
  /** Shape glyph so severity reads without colour too. */
  glyph: string;
  label: string;
  /** CSS colour token. Only critical is red. */
  color: string;
  rank: number;
}

const SEVERITY_META: Record<string, SeverityMeta> = {
  CRITICAL: { glyph: '◆', label: 'Critical', color: 'var(--status-critical)', rank: 4 },
  HIGH: { glyph: '▲', label: 'High', color: 'var(--status-serious)', rank: 3 },
  MEDIUM: { glyph: '●', label: 'Medium', color: 'var(--status-warning)', rank: 2 },
  LOW: { glyph: '○', label: 'Low', color: 'var(--text-muted)', rank: 1 },
};

export function severityMeta(severity: string | null | undefined): SeverityMeta {
  return SEVERITY_META[String(severity ?? '').toUpperCase()] ?? SEVERITY_META.LOW!;
}

/** What the "Run now" sequence shows for a run status. */
export type RunOutcome = 'opened' | 'deduped' | 'clear' | 'limited' | 'error';

export function runOutcome(status: string | null | undefined): RunOutcome {
  switch (status) {
    case 'investigation_opened':
      return 'opened';
    case 'deduped':
      return 'deduped';
    case 'ok':
      return 'clear';
    case 'rate_limited':
      return 'limited';
    default:
      return 'error';
  }
}

/** Pipeline stages of the explainer strip, in order. */
export const PIPELINE_STAGES = ['watch', 'detect', 'investigate', 'notify'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Furthest stage a monitor's last run reached. */
export function pipelineStageForStatus(status: string | null | undefined): PipelineStage {
  switch (status) {
    case 'investigation_opened':
      return 'notify';
    case 'deduped':
      return 'investigate';
    case 'anomaly':
    case 'rate_limited':
      return 'detect';
    default:
      return 'watch';
  }
}

/** YYYY-MM-DD `days` before `end` (UTC), or null. */
export function shiftDay(end: string | null | undefined, days: number): string | null {
  if (!end) return null;
  const t = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

export interface SparkPoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

export interface Sparkline {
  /** SVG path of the line (gaps skipped). */
  line: string;
  /** Closed path for the area under the line. */
  area: string;
  points: SparkPoint[];
  min: number;
  max: number;
  /** x position of a day (YYYY-MM-DD), or null when it is not in the series. */
  xOf: (date: string) => number | null;
  /** y position of a value. */
  yOf: (value: number) => number;
}

/** Scales a daily series into an SVG box. Null values are skipped. */
export function buildSparkline(
  series: { date: string; value: number | null }[],
  width: number,
  height: number,
  pad = 4,
): Sparkline {
  const values = series.map((p) => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const n = series.length;
  const xAt = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const yOf = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const index = new Map(series.map((p, i) => [p.date.slice(0, 10), i]));
  const points: SparkPoint[] = [];
  series.forEach((p, i) => {
    if (typeof p.value === 'number' && Number.isFinite(p.value)) {
      points.push({ x: xAt(i), y: yOf(p.value), date: p.date.slice(0, 10), value: p.value });
    }
  });
  const r = (v: number) => Math.round(v * 10) / 10;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join(' ');
  const area = points.length
    ? `${line} L${r(points[points.length - 1]!.x)} ${height} L${r(points[0]!.x)} ${height} Z`
    : '';
  return {
    line,
    area,
    points,
    min,
    max,
    xOf: (date) => {
      const i = index.get(date.slice(0, 10));
      return i === undefined ? null : xAt(i);
    },
    yOf,
  };
}

export interface RadarBlip {
  date: string;
  /** Degrees clockwise from 12 o'clock: position of the day in the series. */
  angle: number;
  /** 0 (centre) to 1 (rim): larger deviations sit further out. */
  radius: number;
  severity: string;
  direction: string;
}

/** Places anomalies on a radar: angle by day, distance by |deviationScore|. */
export function radarBlips(
  series: { date: string }[],
  anomalies: { date: string; deviationScore: number; severity: string; direction: string }[],
): RadarBlip[] {
  const n = series.length;
  const index = new Map(series.map((p, i) => [p.date.slice(0, 10), i]));
  const maxDev = Math.max(1, ...anomalies.map((a) => Math.abs(a.deviationScore) || 0));
  return anomalies.map((a) => {
    const i = index.get(a.date.slice(0, 10)) ?? 0;
    return {
      date: a.date,
      angle: n > 1 ? (i / n) * 360 : 0,
      radius: 0.35 + 0.6 * Math.min(1, Math.abs(a.deviationScore) / maxDev),
      severity: a.severity,
      direction: a.direction,
    };
  });
}

/** Anomalies grouped under their UTC day, newest day first. */
export function groupAnomaliesByDay<T extends Pick<AnomalyRecord, 'detectedAt'>>(list: T[]): { day: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const a of list) {
    const day = String(a.detectedAt).slice(0, 10);
    const items = groups.get(day);
    if (items) items.push(a);
    else groups.set(day, [a]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, items]) => ({ day, items }));
}

/** Narrows a run result's loosely typed `anomaly` to a MonitorAnomaly, or null. */
export function asMonitorAnomaly(x: unknown): MonitorAnomaly | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (typeof a.date !== 'string' || typeof a.value !== 'number' || typeof a.expectedValue !== 'number') return null;
  return {
    date: a.date,
    timestamp: typeof a.timestamp === 'string' ? a.timestamp : `${a.date}T00:00:00Z`,
    direction: typeof a.direction === 'string' ? a.direction : 'drop',
    severity: typeof a.severity === 'string' ? a.severity : 'LOW',
    value: a.value,
    expectedValue: a.expectedValue,
    deviationScore: typeof a.deviationScore === 'number' ? a.deviationScore : 0,
    detectionMethod: typeof a.detectionMethod === 'string' ? a.detectionMethod : '',
    description: typeof a.description === 'string' ? a.description : '',
  };
}

/** "$19,944" for USD, "1,234" otherwise (whole units, for big numbers). */
export function formatMetric(value: number, unit: string | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0 }).format(value);
  if (unit === 'USD') return value < 0 ? `-$${n.slice(1)}` : `$${n}`;
  return n;
}
