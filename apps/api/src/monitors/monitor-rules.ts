import { AnomalySeverity } from '@helix/database';
import type { EngineAnomaly, EngineFilter } from '../clients/analytics-engine.client';

/**
 * Pure monitoring rules (build spec section 8): which monitors to suggest for
 * a table, which detected anomaly a monitor acts on, and how the resulting
 * investigation is keyed and worded. No I/O here so it is unit-testable.
 */

export interface SchemaColumn {
  name: string;
  type: string;
  semanticType?: string | null;
}

export interface MonitorSuggestion {
  name: string;
  metricKey: string;
  dataSourceId: string;
  dataSourceName: string;
  tableName: string;
  timeColumn: string;
  valueColumn: string | null;
  aggregation: 'sum' | 'count' | 'count_distinct';
  filter: EngineFilter | null;
  unit: string | null;
}

// Same column heuristics as agents/analytics/helix_agent_analytics/planner.py.
export const REFUND_STATUS_VALUES = ['refunded', 'refund', 'returned'];
const STATUS_NAMES = ['status', 'state', 'order_status', 'payment_status'];
const MONEY_WORDS = [
  'amount',
  'revenue',
  'price',
  'total',
  'sales',
  'gmv',
  'value',
  'cost',
  'subtotal',
];
const CUSTOMER_WORDS = ['customer', 'user', 'client', 'account', 'buyer'];
const NUMERIC_TYPE_WORDS = [
  'int',
  'float',
  'double',
  'numeric',
  'decimal',
  'real',
  'money',
  'number',
];
const DATETIME_TYPE_WORDS = ['timestamp', 'datetime', 'date', 'time'];

const semantic = (c: SchemaColumn) => (c.semanticType ?? '').toLowerCase() || null;
const typeHas = (c: SchemaColumn, words: string[]) =>
  words.some((w) => (c.type ?? '').toLowerCase().includes(w));
const nameHas = (c: SchemaColumn, words: string[]) =>
  words.some((w) => c.name.toLowerCase().includes(w));

/** First column matching the earliest predicate that matches anything. */
function first(cols: SchemaColumn[], ...predicates: ((c: SchemaColumn) => boolean)[]) {
  for (const p of predicates) {
    const hit = cols.find(p);
    if (hit) return hit;
  }
  return null;
}

export function pickTimeColumn(cols: SchemaColumn[]): SchemaColumn | null {
  return first(
    cols,
    (c) => semantic(c) === 'datetime' && nameHas(c, ['created', 'order', 'date']),
    (c) => semantic(c) === 'datetime',
    (c) => semantic(c) === null && typeHas(c, DATETIME_TYPE_WORDS),
    (c) =>
      semantic(c) === null &&
      (c.name.toLowerCase().endsWith('_at') || nameHas(c, ['date', 'time'])),
  );
}

const isNumeric = (c: SchemaColumn) =>
  semantic(c) === 'numeric' ||
  semantic(c) === 'currency' ||
  (semantic(c) === null && typeHas(c, NUMERIC_TYPE_WORDS));

export function pickCurrencyColumn(cols: SchemaColumn[]): SchemaColumn | null {
  return first(
    cols,
    (c) => semantic(c) === 'currency',
    (c) => isNumeric(c) && nameHas(c, MONEY_WORDS) && !nameHas(c, ['_id']),
  );
}

export function pickCustomerColumn(cols: SchemaColumn[]): SchemaColumn | null {
  return first(
    cols,
    (c) => semantic(c) === 'identifier' && nameHas(c, CUSTOMER_WORDS),
    (c) => nameHas(c, CUSTOMER_WORDS) && c.name.toLowerCase().endsWith('id'),
  );
}

/** Refund filter on a status-like column (the spec only suggests refunds when one exists). */
export function pickRefundFilter(cols: SchemaColumn[]): EngineFilter | null {
  const status = first(
    cols,
    (c) => STATUS_NAMES.includes(c.name.toLowerCase()),
    (c) => nameHas(c, ['status']) && [null, 'categorical', 'text'].includes(semantic(c)),
  );
  return status ? { column: status.name, op: 'in', value: [...REFUND_STATUS_VALUES] } : null;
}

/** Monitor suggestions for one table; empty when it has no datetime column. */
export function suggestForTable(
  source: { id: string; name: string },
  table: { tableName: string; columns: SchemaColumn[] },
): MonitorSuggestion[] {
  const time = pickTimeColumn(table.columns);
  if (!time) return [];
  const base = {
    dataSourceId: source.id,
    dataSourceName: source.name,
    tableName: table.tableName,
    timeColumn: time.name,
  };
  const out: MonitorSuggestion[] = [];
  const money = pickCurrencyColumn(table.columns);
  if (money) {
    out.push({
      ...base,
      name: 'Daily revenue',
      metricKey: 'revenue',
      valueColumn: money.name,
      aggregation: 'sum',
      filter: null,
      unit: 'USD',
    });
  }
  out.push({
    ...base,
    name: 'Daily orders',
    metricKey: 'orders',
    valueColumn: null,
    aggregation: 'count',
    filter: null,
    unit: null,
  });
  const refund = pickRefundFilter(table.columns);
  if (refund) {
    out.push({
      ...base,
      name: 'Daily refunds',
      metricKey: 'refunds',
      valueColumn: null,
      aggregation: 'count',
      filter: refund,
      unit: null,
    });
  }
  const customer = pickCustomerColumn(table.columns);
  if (customer) {
    out.push({
      ...base,
      name: 'Daily active customers',
      metricKey: 'customers',
      valueColumn: customer.name,
      aggregation: 'count_distinct',
      filter: null,
      unit: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------- anomaly selection

const SEVERITY_RANK: Record<AnomalySeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export const severityAtLeast = (s: AnomalySeverity, min: AnomalySeverity) =>
  SEVERITY_RANK[s] >= SEVERITY_RANK[min];

const DAY_MS = 86_400_000;
const dayOf = (timestamp: string) => timestamp.slice(0, 10);
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

export interface PickedAnomaly extends EngineAnomaly {
  /** YYYY-MM-DD (UTC) of the anomalous day. */
  date: string;
}

export interface AnomalyChoice {
  /** Last day of the series (the lookback anchor), or null for an empty series. */
  seriesEnd: string | null;
  /** Anomalies that passed the lookback and severity filters. */
  candidates: number;
  picked: PickedAnomaly | null;
}

/**
 * Keeps anomalies whose day is within `lookbackDays` of the series' LAST day
 * (not the wall clock, so historical datasets still work) and whose severity
 * is at least `minSeverity`, then picks the most severe, then the most
 * recent, then the largest |deviationScore|.
 */
export function chooseAnomaly(
  series: { timestamp: string }[],
  anomalies: EngineAnomaly[],
  opts: { lookbackDays: number; minSeverity: AnomalySeverity },
): AnomalyChoice {
  const days = [
    ...series.map((p) => dayOf(p.timestamp)),
    ...anomalies.map((a) => dayOf(a.timestamp)),
  ];
  const seriesEnd = days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
  if (!seriesEnd) return { seriesEnd, candidates: 0, picked: null };
  const end = dayNumber(seriesEnd);

  const eligible = anomalies
    .map((a) => ({ ...a, date: dayOf(a.timestamp) }))
    .filter((a) => SEVERITY_RANK[a.severity] !== undefined)
    .filter((a) => end - dayNumber(a.date) <= opts.lookbackDays && end - dayNumber(a.date) >= 0)
    .filter((a) => severityAtLeast(a.severity, opts.minSeverity));
  eligible.sort(
    (x, y) =>
      SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] ||
      y.date.localeCompare(x.date) ||
      Math.abs(y.deviationScore) - Math.abs(x.deviationScore),
  );
  return { seriesEnd, candidates: eligible.length, picked: eligible[0] ?? null };
}

export const dedupeKey = (monitorId: string, date: string, direction: string) =>
  `${monitorId}:${date}:${direction}`;

export const redisDedupeKey = (key: string) => `helix:monitor:dedupe:${key}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** Percent change of value vs expected, 1 decimal, or null when expected is 0 or unknown. */
export function changePercent(value: number, expected: number | null | undefined): number | null {
  if (expected === null || expected === undefined || expected === 0 || !Number.isFinite(expected)) {
    return null;
  }
  return Math.round((Math.abs(value - expected) / Math.abs(expected)) * 1000) / 10;
}

/** e.g. "Investigate the 39.8% drop in Daily revenue detected on Thursday 2026-10-08". */
export function investigationQuestion(monitorName: string, a: PickedAnomaly): string {
  const pct = changePercent(a.value, a.expectedValue);
  const what = pct === null ? a.direction : `${pct.toFixed(1)}% ${a.direction}`;
  return `Investigate the ${what} in ${monitorName} detected on ${weekday(a.date)} ${a.date}`;
}
