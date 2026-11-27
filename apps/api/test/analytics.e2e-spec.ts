import { INestApplication } from '@nestjs/common';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { UpstreamError } from '../src/clients/http';
import { as, createApp, createOrg, mockClients, signup, TestUser } from './helpers';

const ORDERS = {
  tableName: 'orders',
  columns: [
    { name: 'order_id', type: 'text', nullable: false, semanticType: 'identifier' },
    { name: 'created_at', type: 'timestamp', nullable: false, semanticType: 'datetime' },
    { name: 'customer_id', type: 'text', nullable: false, semanticType: 'identifier' },
    { name: 'channel', type: 'text', nullable: false, semanticType: 'categorical' },
    { name: 'amount', type: 'float', nullable: false, semanticType: 'currency' },
    { name: 'status', type: 'text', nullable: false, semanticType: 'categorical' },
  ],
  rowCountEstimate: 25000,
};

const DAY = 86_400_000;
const START = Date.parse('2026-07-17T00:00:00Z');
const ts = (i: number) => new Date(START + i * DAY).toISOString();
const DROP_INDEX = 83; // 2026-10-08

/** 90 days scored for every day (threshold ~0): residual = 500 * score + 0. */
function detection(base: number, dropScore: number) {
  const values = Array.from({ length: 90 }, (_, i) => (i === DROP_INDEX ? base + dropScore * 500 : base + ((i % 5) - 2) * 100));
  return {
    metric: {
      name: 'm',
      unit: null,
      value: values.at(-1),
      baseline: null,
      changePercent: null,
      series: values.map((value, i) => ({ timestamp: ts(i), value })),
      computationMethod: 'daily',
      computedAt: '2026-11-27T00:00:00Z',
    },
    methodUsed: 'seasonal',
    computationMethod: 'seasonal',
    anomalies: values
      .map((value, i) => ({
        timestamp: ts(i),
        value,
        expectedValue: base,
        deviationScore: (value - base) / 500,
        severity: i === DROP_INDEX ? 'CRITICAL' : 'LOW',
        direction: value < base ? 'drop' : 'spike',
        detectionMethod: 'stl_seasonal',
        description: 'd',
      }))
      .filter((a) => a.deviationScore !== 0),
  };
}

function kpiMetric(name: string, value: number, baseline: number) {
  return {
    name,
    unit: null,
    value,
    baseline,
    changePercent: ((value - baseline) / baseline) * 100,
    series: Array.from({ length: 60 }, (_, i) => ({ timestamp: ts(30 + i), value: value / 30 })),
    computationMethod: 'kpi',
    pValue: null,
    window: { currentStart: '2026-09-15', currentEnd: '2026-10-14', previousStart: '2026-08-16', previousEnd: '2026-09-14' },
  };
}

describe('Analytics (e2e)', () => {
  const base = mockClients();
  const engine = {
    detectAnomalies: jest.fn(),
    kpis: jest.fn(),
    forecast: jest.fn(),
    compareSegments: jest.fn(),
  };
  const mocks = { ...base, analyticsEngine: engine };
  let app: INestApplication;
  let owner: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let emptyOrgId: string;

  beforeAll(async () => {
    app = await createApp(mocks);
    owner = await signup(app, 'an-owner');
    outsider = await signup(app, 'an-outsider');
    orgId = await createOrg(app, owner, 'Analytics Co');
    emptyOrgId = await createOrg(app, owner, 'Empty Co');
    mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS] });
    await as(app, owner, orgId)
      .post('/data-sources')
      .send({ name: 'orders', config: { host: 'h', database: 'd' }, credentials: { user: 'u', password: 'p' } })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.get(AnalyticsService).invalidate();
    for (const fn of Object.values(engine)) fn.mockReset();
    engine.detectAnomalies.mockImplementation(async (body: { aggregation: string; filter: unknown }) =>
      body.aggregation === 'sum' ? detection(33_000, -8) : body.filter ? detection(10, 10) : detection(300, -6),
    );
    engine.kpis.mockImplementation(async (body: { kpis: { name: string }[] }) => ({
      metrics: body.kpis.map((k) =>
        k.name === 'revenue'
          ? kpiMetric('revenue', 900_000, 800_000)
          : k.name === 'orders'
            ? kpiMetric('orders', 9_000, 8_000)
            : k.name === 'aov'
              ? kpiMetric('aov', 100, 100)
              : k.name === 'refund_rate'
                ? kpiMetric('refund_rate', 0.04, 0.03)
                : kpiMetric(k.name, k.name === 'web' ? 500_000 : 250_000, 240_000),
      ),
    }));
    engine.forecast.mockResolvedValue({
      history: [],
      forecast: [{ timestamp: ts(90), value: 33_000, lower: 30_000, upper: 36_000 }],
      methodUsed: 'ets',
      backtest: { mape: 10.8, holdoutDays: 14 },
      computationMethod: 'ets',
    });
    engine.compareSegments.mockResolvedValue({
      targetDate: '2026-10-08',
      metricName: 'Daily revenue',
      unit: null,
      aggregation: 'sum',
      total: { actual: 29_000, expected: 33_000, delta: -4_000, deltaPercent: -12.1 },
      dimensions: [
        {
          column: 'channel',
          concentration: 0.9,
          slices: [
            { value: 'web', actual: 3_000, expected: 17_500, delta: -14_500, deltaPercent: -82.9, shareOfDelta: 1.15 },
            { value: 'mobile', actual: 11_800, expected: 10_000, delta: 1_800, deltaPercent: 18, shareOfDelta: -0.14 },
          ],
        },
      ],
      topSlice: { column: 'channel', value: 'web', actual: 3_000, expected: 17_500, delta: -14_500, deltaPercent: -82.9, shareOfDelta: 1.15 },
      computationMethod: 'segments',
    });
  });

  it('serves KPIs from the engine, scoped to the org data source and anchored to the series end', async () => {
    const res = await as(app, owner, orgId).get('/analytics/overview').expect(200);
    expect(res.body.kpis.map((k: { key: string }) => k.key)).toEqual(['revenue', 'orders', 'aov', 'refund_rate']);
    expect(res.body.kpis[0]).toMatchObject({ unit: 'currency', value: 900_000, delta: 0.125 });
    expect(res.body.kpis[0].spark).toHaveLength(30);
    expect(res.body.kpis[3]).toMatchObject({ unit: 'percent', value: 0.04 });
    expect(res.body.source).toMatchObject({ table: 'orders', seriesEnd: '2026-10-14' });

    const detectBody = engine.detectAnomalies.mock.calls[0][0];
    expect(detectBody.dataset).toEqual({ dataSourceId: res.body.source.dataSourceId, organizationId: orgId, table: 'orders' });
    expect(detectBody.threshold).toBeLessThan(0.001);
    expect(engine.kpis.mock.calls[0][0]).toMatchObject({ asOf: '2026-10-14', windowDays: 30 });
  });

  it('builds the revenue band, anomaly flag, segment split and drop story', async () => {
    const res = await as(app, owner, orgId).get('/analytics/revenue').expect(200);
    const { series } = res.body;
    expect(series).toHaveLength(90);
    const drop = series.find((p: { date: string }) => p.date === '2026-10-08');
    expect(drop).toMatchObject({ isAnomaly: true, forecast: 33_000, lower: 31_500, upper: 34_500, zScore: -8 });
    expect(series.filter((p: { isAnomaly: boolean }) => p.isAnomaly)).toHaveLength(1);
    expect(res.body.segmentColumn).toBe('channel');
    expect(res.body.bySegment[0]).toEqual({ segment: 'web', current: 500_000, previous: 240_000 });
    expect(res.body.channelMix.map((c: { share: number }) => c.share).reduce((a: number, b: number) => a + b)).toBeCloseTo(1, 3);
    expect(res.body.story).toMatchObject({
      date: '2026-10-08',
      weekday: 'Thursday',
      direction: 'drop',
      severity: 'critical',
      dimension: 'channel',
      topSlice: { column: 'channel', value: 'web' },
    });
    expect(res.body.projection).toEqual([{ date: '2026-10-15', value: 33_000, lower: 30_000, upper: 36_000 }]);
    expect(res.body.bandMethod).toMatch(/not a backtest/);
    expect(engine.compareSegments.mock.calls[0][0]).toMatchObject({ targetDate: '2026-10-08' });
  });

  it('lists anomalies across metrics with a |z| heatmap', async () => {
    const res = await as(app, owner, orgId).get('/analytics/anomalies').expect(200);
    expect(res.body.heatmap.metrics).toEqual(['Revenue', 'Orders', 'Refunds', 'Active customers']);
    expect(res.body.heatmap.days).toHaveLength(28);
    expect(res.body.heatmap.days.at(-1)).toBe('2026-10-14');
    const col = res.body.heatmap.days.indexOf('2026-10-08');
    expect(res.body.heatmap.cells[0][col]).toBe(8);
    const revenue = res.body.items.find((i: { id: string }) => i.id === 'revenue-2026-10-08');
    expect(revenue).toMatchObject({ severity: 'critical', zScore: -8, segment: 'channel: web', metricKey: 'revenue' });
    expect(res.body.items.every((i: { severity: string }) => ['critical', 'serious', 'warning'].includes(i.severity))).toBe(true);
  });

  it('caches per org for 60s across the four endpoints', async () => {
    const api = as(app, owner, orgId);
    await api.get('/analytics/overview').expect(200);
    const calls = engine.detectAnomalies.mock.calls.length;
    await api.get('/analytics/revenue').expect(200);
    await api.get('/analytics/anomalies').expect(200);
    expect(engine.detectAnomalies.mock.calls.length).toBe(calls);
  });

  it('counts investigations per day by trigger', async () => {
    const res = await as(app, owner, orgId).get('/analytics/throughput').expect(200);
    expect(res.body).toHaveLength(14);
    expect(res.body.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
    expect(Object.keys(res.body[0]).sort()).toEqual(['anomaly', 'date', 'question', 'scheduled']);
  });

  it('404s without a usable source, 503s when the engine is down, and enforces tenancy', async () => {
    await as(app, owner, emptyOrgId).get('/analytics/revenue').expect(404);
    expect(engine.detectAnomalies).not.toHaveBeenCalled();
    await as(app, owner, emptyOrgId).get('/analytics/throughput').expect(200);

    engine.detectAnomalies.mockRejectedValue(new UpstreamError('down', null));
    await as(app, owner, orgId).get('/analytics/overview').expect(503);

    await as(app, outsider, orgId).get('/analytics/overview').expect(403);
    await as(app, owner).get('/analytics/overview').expect(400);
  });
});
