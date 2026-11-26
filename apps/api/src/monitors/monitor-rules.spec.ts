import type { EngineAnomaly } from '../clients/analytics-engine.client';
import {
  changePercent,
  chooseAnomaly,
  dedupeKey,
  investigationQuestion,
  suggestForTable,
} from './monitor-rules';

const ORDERS = {
  tableName: 'orders',
  columns: [
    { name: 'order_id', type: 'text', semanticType: 'identifier' },
    { name: 'created_at', type: 'timestamp', semanticType: 'datetime' },
    { name: 'customer_id', type: 'text', semanticType: 'identifier' },
    { name: 'channel', type: 'text', semanticType: 'categorical' },
    { name: 'amount', type: 'float', semanticType: 'currency' },
    { name: 'status', type: 'text', semanticType: 'categorical' },
  ],
};
const DS = { id: 'ds-1', name: 'orders.csv' };

function anomaly(
  day: string,
  severity: EngineAnomaly['severity'],
  extra: Partial<EngineAnomaly> = {},
) {
  return {
    timestamp: `${day}T00:00:00+00:00`,
    value: 19950,
    expectedValue: 33124,
    deviationScore: -6.1,
    severity,
    direction: 'drop',
    detectionMethod: 'seasonal',
    description: 'd',
    ...extra,
  } as EngineAnomaly;
}
const series = (from: string, days: number) =>
  Array.from({ length: days }, (_, i) => ({
    timestamp: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString(),
  }));

describe('suggestForTable', () => {
  it('suggests revenue, orders, refunds and active customers for an orders table', () => {
    const out = suggestForTable(DS, ORDERS);
    expect(out.map((s) => s.metricKey)).toEqual(['revenue', 'orders', 'refunds', 'customers']);
    expect(out[0]).toMatchObject({
      name: 'Daily revenue',
      dataSourceId: 'ds-1',
      dataSourceName: 'orders.csv',
      tableName: 'orders',
      timeColumn: 'created_at',
      valueColumn: 'amount',
      aggregation: 'sum',
      unit: 'USD',
      filter: null,
    });
    expect(out[2]).toMatchObject({
      aggregation: 'count',
      filter: { column: 'status', op: 'in', value: ['refunded', 'refund', 'returned'] },
    });
    expect(out[3]).toMatchObject({ aggregation: 'count_distinct', valueColumn: 'customer_id' });
  });

  it('falls back to column types and names when semantic types are missing', () => {
    const out = suggestForTable(DS, {
      tableName: 'sales',
      columns: [
        { name: 'sold_on', type: 'date' },
        { name: 'total_price', type: 'numeric' },
      ],
    });
    expect(out.map((s) => s.metricKey)).toEqual(['revenue', 'orders']);
    expect(out[0]).toMatchObject({ timeColumn: 'sold_on', valueColumn: 'total_price' });
  });

  it('suggests nothing without a datetime column', () => {
    expect(suggestForTable(DS, { tableName: 'x', columns: [{ name: 'a', type: 'int' }] })).toEqual(
      [],
    );
  });
});

describe('chooseAnomaly', () => {
  // The fixture series ends 2026-10-14, long before "now": lookback is relative to it.
  const s = series('2026-07-17', 90);

  it('uses the last day of the series, not the wall clock, as the lookback anchor', () => {
    const res = chooseAnomaly(s, [anomaly('2026-10-08', 'HIGH')], {
      lookbackDays: 7,
      minSeverity: 'HIGH',
    });
    expect(res.seriesEnd).toBe('2026-10-14');
    expect(res.picked).toMatchObject({ date: '2026-10-08', severity: 'HIGH' });
  });

  it('ignores anomalies older than lookbackDays or below minSeverity', () => {
    const res = chooseAnomaly(
      s,
      [anomaly('2026-09-01', 'CRITICAL'), anomaly('2026-10-12', 'MEDIUM')],
      { lookbackDays: 7, minSeverity: 'HIGH' },
    );
    expect(res).toMatchObject({ candidates: 0, picked: null });
    const lower = chooseAnomaly(s, [anomaly('2026-10-12', 'MEDIUM')], {
      lookbackDays: 7,
      minSeverity: 'MEDIUM',
    });
    expect(lower.picked?.date).toBe('2026-10-12');
  });

  it('picks the most severe, then the most recent', () => {
    const res = chooseAnomaly(
      s,
      [
        anomaly('2026-10-13', 'HIGH'),
        anomaly('2026-10-08', 'CRITICAL'),
        anomaly('2026-10-09', 'CRITICAL', { direction: 'spike' }),
      ],
      { lookbackDays: 7, minSeverity: 'HIGH' },
    );
    expect(res.candidates).toBe(3);
    expect(res.picked).toMatchObject({ date: '2026-10-09', direction: 'spike' });
  });

  it('handles an empty series', () => {
    expect(chooseAnomaly([], [], { lookbackDays: 7, minSeverity: 'LOW' })).toEqual({
      seriesEnd: null,
      candidates: 0,
      picked: null,
    });
  });
});

describe('question and keys', () => {
  it('words the investigation question from the anomaly', () => {
    const picked = { ...anomaly('2026-10-08', 'HIGH'), date: '2026-10-08' };
    expect(investigationQuestion('Daily revenue', picked)).toBe(
      'Investigate the 39.8% drop in Daily revenue detected on Thursday 2026-10-08',
    );
    expect(
      investigationQuestion('Daily refunds', { ...picked, expectedValue: 0, direction: 'spike' }),
    ).toBe('Investigate the spike in Daily refunds detected on Thursday 2026-10-08');
  });

  it('computes percent change and dedupe keys', () => {
    expect(changePercent(26, 171.5)).toBe(84.8);
    expect(changePercent(5, 0)).toBeNull();
    expect(dedupeKey('m1', '2026-10-08', 'drop')).toBe('m1:2026-10-08:drop');
  });
});
