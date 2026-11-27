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
  buildSparkline,
  groupAnomaliesByDay,
  pipelineStageForStatus,
  radarBlips,
  runOutcome,
  severityMeta,
  shiftDay,
  asMonitorAnomaly,
  formatMetric,
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

describe('visual helpers', () => {
  it('maps severities to glyphs, reserving red for critical', () => {
    expect(severityMeta('CRITICAL')).toMatchObject({ glyph: '◆', color: 'var(--status-critical)', rank: 4 });
    expect(severityMeta('high').glyph).toBe('▲');
    expect(severityMeta('nope').label).toBe('Low');
    expect(severityMeta(null).rank).toBe(1);
  });

  it('maps run statuses to outcomes and pipeline stages', () => {
    expect(runOutcome('investigation_opened')).toBe('opened');
    expect(runOutcome('deduped')).toBe('deduped');
    expect(runOutcome('ok')).toBe('clear');
    expect(runOutcome('rate_limited')).toBe('limited');
    expect(runOutcome('error')).toBe('error');
    expect(runOutcome(undefined)).toBe('error');
    expect(pipelineStageForStatus('investigation_opened')).toBe('notify');
    expect(pipelineStageForStatus('deduped')).toBe('investigate');
    expect(pipelineStageForStatus('rate_limited')).toBe('detect');
    expect(pipelineStageForStatus(null)).toBe('watch');
  });

  it('shifts UTC days', () => {
    expect(shiftDay('2026-10-14', 7)).toBe('2026-10-07');
    expect(shiftDay('2026-10-14T00:00:00Z', 0)).toBe('2026-10-14');
    expect(shiftDay(null, 3)).toBeNull();
    expect(shiftDay('garbage', 3)).toBeNull();
  });

  it('scales a series into a sparkline and skips gaps', () => {
    const s = buildSparkline(
      [
        { date: '2026-10-01', value: 10 },
        { date: '2026-10-02', value: null },
        { date: '2026-10-03', value: 20 },
      ],
      100,
      50,
      0,
    );
    expect(s.points).toHaveLength(2);
    expect(s.points[0]).toMatchObject({ x: 0, y: 50, value: 10 });
    expect(s.points[1]).toMatchObject({ x: 100, y: 0, value: 20 });
    expect(s.line).toBe('M0 50 L100 0');
    expect(s.area).toBe('M0 50 L100 0 L100 50 L0 50 Z');
    expect(s.xOf('2026-10-02')).toBe(50);
    expect(s.xOf('2026-12-01')).toBeNull();
    expect(buildSparkline([], 100, 50).line).toBe('');
  });

  it('places radar blips by day and deviation', () => {
    const series = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((date) => ({ date }));
    const blips = radarBlips(series, [
      { date: '2026-10-03', deviationScore: -8, severity: 'CRITICAL', direction: 'drop' },
      { date: '2026-10-01', deviationScore: 4, severity: 'HIGH', direction: 'spike' },
    ]);
    expect(blips[0]).toMatchObject({ angle: 180, radius: 0.95, severity: 'CRITICAL' });
    expect(blips[1]!.angle).toBe(0);
    expect(blips[1]!.radius).toBeCloseTo(0.65);
  });

  it('groups anomalies by UTC day, newest first', () => {
    const groups = groupAnomaliesByDay([
      { detectedAt: '2026-10-08T00:00:00.000Z', id: 'a' },
      { detectedAt: '2026-10-09T00:00:00.000Z', id: 'b' },
      { detectedAt: '2026-10-08T00:00:00.000Z', id: 'c' },
    ]);
    expect(groups.map((g) => g.day)).toEqual(['2026-10-09', '2026-10-08']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('asMonitorAnomaly / formatMetric', () => {
  it('narrows run anomalies', () => {
    expect(asMonitorAnomaly(null)).toBeNull();
    expect(asMonitorAnomaly({ date: '2026-10-08' })).toBeNull();
    expect(
      asMonitorAnomaly({ date: '2026-10-08', value: 1, expectedValue: 2, severity: 'CRITICAL', direction: 'drop' }),
    ).toMatchObject({ date: '2026-10-08', timestamp: '2026-10-08T00:00:00Z', severity: 'CRITICAL', deviationScore: 0 });
  });
  it('formats metric values', () => {
    expect(formatMetric(19944.04, 'USD')).toBe('$19,944');
    expect(formatMetric(-5, 'USD')).toBe('-$5');
    expect(formatMetric(37, null)).toBe('37');
    expect(formatMetric(323.49, null)).toBe('323');
    expect(formatMetric(Number.NaN, null)).toBe('-');
  });
});
