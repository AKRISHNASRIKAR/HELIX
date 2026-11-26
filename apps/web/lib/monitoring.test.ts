import { describe, expect, it } from 'vitest';
import type { AnomalyRecord, Monitor } from './api';
import {
  anomalyChange,
  anomalyMetricName,
  autonomousInvestigations,
  describeAggregation,
  monitorStatusLabel,
  monitorStatusTone,
  suggestionKey,
  summarizeMonitors,
} from './monitoring';

const monitor = (over: Partial<Monitor>): Monitor =>
  ({
    id: 'm',
    name: 'Daily revenue',
    projectId: 'p',
    dataSourceId: 'd',
    metricKey: 'revenue',
    tableName: 'orders',
    timeColumn: 'created_at',
    valueColumn: 'amount',
    aggregation: 'sum',
    minSeverity: 'HIGH',
    lookbackDays: 7,
    cooldownHours: 24,
    enabled: true,
    lastRunAt: null,
    lastStatus: null,
    lastMessage: null,
    ...over,
  }) as Monitor;

describe('monitor status', () => {
  it('labels and tones each status', () => {
    expect(monitorStatusLabel(null)).toBe('Never run');
    expect(monitorStatusLabel('investigation_opened')).toBe('Investigation opened');
    expect(monitorStatusLabel('something_new')).toBe('something new');
    expect(monitorStatusTone('ok')).toBe('good');
    expect(monitorStatusTone('investigation_opened')).toBe('warn');
    expect(monitorStatusTone('error')).toBe('bad');
    expect(monitorStatusTone('deduped')).toBe('info');
    expect(monitorStatusTone(undefined)).toBe('muted');
  });
});

describe('describeAggregation / suggestionKey', () => {
  it('formats the series spec', () => {
    expect(describeAggregation({ aggregation: 'sum', valueColumn: 'amount' })).toBe('sum(amount)');
    expect(describeAggregation({ aggregation: 'count', valueColumn: null })).toBe('count(*)');
    expect(suggestionKey({ dataSourceId: 'd', tableName: 'orders', metricKey: 'refunds' })).toBe('d:orders:refunds');
  });
});

describe('autonomousInvestigations', () => {
  it('keeps ANOMALY_DETECTED investigations, newest first', () => {
    const list = [
      { id: '1', triggerType: 'USER_QUESTION', createdAt: '2026-11-26T10:00:00Z' },
      { id: '2', triggerType: 'ANOMALY_DETECTED', createdAt: '2026-11-25T10:00:00Z' },
      { id: '3', triggerType: 'ANOMALY_DETECTED', createdAt: '2026-11-26T09:00:00Z' },
    ] as never[];
    expect(autonomousInvestigations(list).map((i: { id: string }) => i.id)).toEqual(['3', '2']);
  });
});

describe('anomalies', () => {
  const a = { id: 'a', description: 'Revenue drop', severity: 'HIGH', detectedAt: '', value: 60, expectedValue: 100, deviationScore: -4 } as AnomalyRecord;
  it('computes change vs expected', () => {
    expect(anomalyChange(a)).toBeCloseTo(-0.4);
    expect(anomalyChange({ ...a, expectedValue: 0 })).toBeNull();
    expect(anomalyChange({ ...a, expectedValue: null })).toBeNull();
  });
  it('prefers the metric name', () => {
    expect(anomalyMetricName(a)).toBe('Revenue drop');
    expect(anomalyMetricName({ ...a, metric: { id: 'x', name: 'Daily revenue' } })).toBe('Daily revenue');
    expect(anomalyMetricName({ ...a, metricName: 'Revenue' })).toBe('Revenue');
  });
});

describe('summarizeMonitors', () => {
  it('counts enabled, latest run and monitors flagging an anomaly', () => {
    const s = summarizeMonitors([
      monitor({ id: '1', lastRunAt: '2026-11-26T10:00:00Z', lastStatus: 'ok' }),
      monitor({ id: '2', enabled: false, lastRunAt: '2026-11-26T11:00:00Z', lastStatus: 'investigation_opened' }),
      monitor({ id: '3' }),
    ]);
    expect(s).toEqual({ total: 3, enabled: 2, lastRunAt: '2026-11-26T11:00:00Z', withAnomaly: 1 });
    expect(summarizeMonitors([])).toEqual({ total: 0, enabled: 0, lastRunAt: null, withAnomaly: 0 });
  });
});
