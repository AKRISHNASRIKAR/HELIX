import type { EngineAnomaly } from '../clients/analytics-engine.client';
import {
  bucketThroughput,
  buildHeatmapCells,
  daysEnding,
  fitBand,
  flagged,
  mapSeverity,
  pickAnalyticsPlan,
  pickSegmentColumn,
  pickStoryAnomaly,
} from './analytics-rules';

const ORDERS_COLUMNS = [
  { name: 'order_id', type: 'text', semanticType: 'identifier' },
  { name: 'created_at', type: 'timestamp', semanticType: 'datetime' },
  { name: 'customer_id', type: 'text', semanticType: 'identifier' },
  { name: 'segment', type: 'text', semanticType: 'categorical' },
  { name: 'channel', type: 'text', semanticType: 'categorical' },
  { name: 'amount', type: 'float', semanticType: 'currency' },
  { name: 'status', type: 'text', semanticType: 'categorical' },
];

function scored(day: string, value: number, expected: number, score: number, severity: EngineAnomaly['severity'] = 'LOW', direction: EngineAnomaly['direction'] = 'drop'): EngineAnomaly {
  return {
    timestamp: `${day}T00:00:00Z`,
    value,
    expectedValue: expected,
    deviationScore: score,
    severity,
    direction,
    detectionMethod: 'stl_seasonal',
    description: 'x',
  };
}

describe('pickAnalyticsPlan', () => {
  it('picks the first orders-like table with the monitor heuristics', () => {
    const plan = pickAnalyticsPlan([
      { id: 'a', name: 'logs', schemas: [{ tableName: 'events', columns: [{ name: 'at', type: 'timestamp', semanticType: 'datetime' }] }] },
      {
        id: 'b',
        name: 'orders',
        schemas: [
          { tableName: 'customers', columns: [{ name: 'created_at', type: 'timestamp', semanticType: 'datetime' }, { name: 'ltv_value', type: 'float', semanticType: 'currency' }] },
          { tableName: 'orders', columns: ORDERS_COLUMNS },
        ],
      },
    ]);
    expect(plan).toEqual({
      source: { id: 'b', name: 'orders' },
      table: 'orders',
      time: 'created_at',
      money: 'amount',
      refundFilter: { column: 'status', op: 'in', value: ['refunded', 'refund', 'returned'] },
      customer: 'customer_id',
      segmentColumn: 'channel',
    });
  });

  it('returns null when nothing has a date and an amount', () => {
    expect(pickAnalyticsPlan([{ id: 'a', name: 'x', schemas: [{ tableName: 't', columns: [{ name: 'id', type: 'int' }] }] }])).toBeNull();
    expect(pickAnalyticsPlan([])).toBeNull();
  });

  it('prefers channel over other categorical columns and skips the status column', () => {
    expect(pickSegmentColumn(ORDERS_COLUMNS, ['status'])).toBe('channel');
    expect(pickSegmentColumn([{ name: 'status', type: 'text', semanticType: 'categorical' }], ['status'])).toBeNull();
  });
});

describe('fitBand', () => {
  it('recovers the detector band so flagged days fall outside it', () => {
    // residual r = value - expected; detector score = (r - 100) / 500.
    const days = daysEnding('2026-10-14', 6);
    const resid = [100, 600, -400, 1100, 100 - 4000, 350];
    const series = days.map((d, i) => ({ timestamp: `${d}T00:00:00Z`, value: 10_000 + resid[i]! }));
    const anoms = days
      .map((d, i) => scored(d, 10_000 + resid[i]!, 10_000, (resid[i]! - 100) / 500, i === 4 ? 'CRITICAL' : 'LOW'))
      .filter((a) => a.deviationScore !== 0);
    const band = fitBand(series, anoms, 3);
    expect(band.sigma).toBeCloseTo(500, 6);
    expect(band.offset).toBeCloseTo(100, 6);
    const crit = band.points[4]!;
    expect(crit).toMatchObject({ forecast: 10_100, lower: 8_600, upper: 11_600, isAnomaly: true, zScore: -8 });
    expect(crit.revenue).toBeLessThan(crit.lower);
    // Day 0 had score 0 (omitted by the detector): centred on its own value.
    expect(band.points[0]).toMatchObject({ revenue: 10_100, forecast: 10_100, isAnomaly: false, zScore: 0 });
    expect(band.points.filter((p) => p.isAnomaly)).toHaveLength(1);
  });
});

describe('severity, story and heatmap', () => {
  it('maps engine severities to dashboard severities', () => {
    expect(mapSeverity('CRITICAL')).toBe('critical');
    expect(mapSeverity('HIGH')).toBe('serious');
    expect(mapSeverity('MEDIUM')).toBe('warning');
    expect(mapSeverity('LOW')).toBeNull();
  });

  it('keeps only |z| >= 3 with a shown severity', () => {
    const list = [scored('2026-10-01', 1, 1, 2.9, 'LOW'), scored('2026-10-02', 1, 1, 4.5, 'HIGH', 'spike'), scored('2026-10-08', 1, 1, -8.2, 'CRITICAL')];
    expect(flagged(list).map((a) => a.timestamp.slice(0, 10))).toEqual(['2026-10-02', '2026-10-08']);
  });

  it('tells the story of the worst drop, not a bigger spike', () => {
    const story = pickStoryAnomaly([
      scored('2026-10-02', 1, 1, 9, 'CRITICAL', 'spike'),
      scored('2026-10-08', 1, 1, -8.2, 'CRITICAL'),
      scored('2026-07-30', 1, 1, -3.8, 'MEDIUM'),
    ]);
    expect(story?.timestamp).toBe('2026-10-08T00:00:00Z');
    expect(pickStoryAnomaly([scored('2026-10-02', 1, 1, 4, 'HIGH', 'spike')])?.direction).toBe('spike');
    expect(pickStoryAnomaly([])).toBeNull();
  });

  it('builds |z| cells per metric per day', () => {
    const days = ['2026-10-07', '2026-10-08'];
    expect(buildHeatmapCells([{ scored: [scored('2026-10-08', 1, 1, -8.171)] }, { scored: [] }], days)).toEqual([
      [0, 8.17],
      [0, 0],
    ]);
  });
});

describe('bucketThroughput', () => {
  it('counts investigations per day by trigger over the last 14 days', () => {
    const out = bucketThroughput(
      [
        { createdAt: new Date('2026-11-27T10:00:00Z'), triggerType: 'USER_QUESTION' },
        { createdAt: new Date('2026-11-27T11:00:00Z'), triggerType: 'MANUAL' },
        { createdAt: new Date('2026-11-26T11:00:00Z'), triggerType: 'ANOMALY_DETECTED' },
        { createdAt: new Date('2026-11-20T11:00:00Z'), triggerType: 'SCHEDULED' },
        { createdAt: new Date('2026-10-01T11:00:00Z'), triggerType: 'SCHEDULED' },
      ],
      new Date('2026-11-27T12:00:00Z'),
    );
    expect(out).toHaveLength(14);
    expect(out[0]!.date).toBe('2026-11-14');
    expect(out.at(-1)).toEqual({ date: '2026-11-27', anomaly: 0, question: 2, scheduled: 0 });
    expect(out.at(-2)).toEqual({ date: '2026-11-26', anomaly: 1, question: 0, scheduled: 0 });
    expect(out.reduce((t, d) => t + d.scheduled, 0)).toBe(1);
  });
});
