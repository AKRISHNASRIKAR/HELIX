/**
 * Response shapes of `GET /analytics/*`. They match the web types in
 * apps/web/lib/api.ts (Overview/Kpi, RevenueData/RevenuePoint,
 * AnomalyData/Anomaly, ThroughputDay); every field beyond those is optional
 * on the web side so the demo fixtures still satisfy it.
 */

export interface AnalyticsSourceRef {
  dataSourceId: string;
  dataSourceName: string;
  table: string;
  timeColumn: string;
  valueColumn: string;
  /** Last day (YYYY-MM-DD, UTC) of the daily series: the anchor for every window. */
  seriesEnd: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: 'currency' | 'percent' | 'count' | 'minutes';
  /** Fractional change vs the previous window (-0.12 = 12% lower). */
  delta: number;
  spark: number[];
  /** Previous window's value. */
  previous?: number | null;
  /** Dates matching `spark`. */
  sparkDays?: string[];
}

export interface Overview {
  generatedAt: string;
  kpis: Kpi[];
  source?: AnalyticsSourceRef;
  window?: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  /** Expected value for the day (see RevenueData.bandMethod). */
  forecast: number;
  lower: number;
  upper: number;
  isAnomaly: boolean;
  /** Robust z-score from the anomaly detector. */
  zScore?: number | null;
}

export interface StorySlice {
  value: string;
  actual: number;
  expected: number;
  delta: number;
  deltaPercent: number | null;
  shareOfDelta: number;
}

/** What happened on the worst revenue anomaly day, from /segments/compare. */
export interface RevenueStory {
  date: string;
  weekday: string;
  direction: 'spike' | 'drop';
  severity: 'critical' | 'serious' | 'warning';
  zScore: number;
  actual: number;
  expected: number;
  delta: number;
  deltaPercent: number | null;
  /** Dimension that concentrates the change most (e.g. "channel"). */
  dimension: string | null;
  slices: StorySlice[];
  topSlice: (StorySlice & { column: string }) | null;
  baselineMethod: string;
}

export interface RevenueData {
  series: RevenuePoint[];
  bySegment: { segment: string; current: number; previous: number }[];
  channelMix: { channel: string; share: number }[];
  /** How forecast/lower/upper were computed (the band is fitted, not a backtest). */
  bandMethod?: string;
  /** Detector used for isAnomaly (e.g. "seasonal"). */
  detectionMethod?: string;
  /** Forward forecast after the series end, from /forecast. */
  projection?: { date: string; value: number; lower: number; upper: number }[];
  projectionMethod?: string;
  projectionMape?: number | null;
  /** Column that bySegment/channelMix/channelSeries are split by. */
  segmentColumn?: string | null;
  /** Daily revenue per channel over the KPI windows. */
  channelSeries?: { channel: string; points: { date: string; value: number }[] }[];
  story?: RevenueStory | null;
  source?: AnalyticsSourceRef;
}

export type Severity = 'critical' | 'serious' | 'warning';

export interface Anomaly {
  id: string;
  metric: string;
  severity: Severity;
  zScore: number;
  change: number;
  detectedAt: string;
  segment: string;
  date?: string;
  metricKey?: string;
  value?: number;
  expectedValue?: number;
  direction?: 'spike' | 'drop';
  description?: string;
}

export interface AnomalyData {
  items: Anomaly[];
  heatmap: { metrics: string[]; days: string[]; cells: number[][]; metricKeys?: string[] };
  /** |z| at or above this is flagged (the detector's threshold). */
  threshold?: number;
  source?: AnalyticsSourceRef;
}

export interface ThroughputDay {
  date: string;
  anomaly: number;
  question: number;
  scheduled: number;
}
