import type { Investigation } from '@helix/contracts';
import type { AnomalyRecord, Monitor, MonitorSuggestion } from './api';

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
