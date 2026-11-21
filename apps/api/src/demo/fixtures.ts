import {
  AgentType,
  AnalyticsType,
  InvestigationStatus,
  InvestigationTriggerType,
  RecommendationPriority,
} from '@helix/types';

/**
 * Deterministic mock data for HELIX_DEMO=1 mode. Lets the web app be run and
 * shown end-to-end without Postgres/Redis or any agents implemented yet.
 * Everything is generated from a seeded PRNG relative to a fixed anchor date
 * so screenshots are reproducible.
 */

const ANCHOR = new Date('2026-10-14T09:00:00Z');
const ORG_ID = '7a1c5e2b-0f4d-4c1e-9b8a-1f2e3d4c5b6a';
const PROJECT_ID = '3b9e1d7c-2a6f-4e8b-8c1d-5f4e3a2b1c0d';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n: number, hour = 9) => {
  const d = new Date(ANCHOR);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const iso = (d: Date) => d.toISOString();
const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// ---------------------------------------------------------------- timeseries

export interface SeriesPoint {
  date: string;
  revenue: number;
  forecast: number;
  lower: number;
  upper: number;
  isAnomaly: boolean;
}

/** 90 days of daily revenue with weekly seasonality, trend, and one injected dip. */
function buildRevenueSeries(): SeriesPoint[] {
  const rand = mulberry32(42);
  const points: SeriesPoint[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = daysAgo(i);
    const t = 89 - i;
    const weekday = d.getUTCDay();
    const season = weekday === 0 || weekday === 6 ? -0.11 : 0.03;
    const expected = 182_000 * (1 + t * 0.0021) * (1 + season);
    let revenue = expected * (1 + (rand() - 0.5) * 0.06);
    // Checkout regression: days 9..6 ago, a sharp dip.
    const anomaly = i <= 9 && i >= 6;
    if (anomaly) revenue = expected * (0.71 + rand() * 0.06);
    points.push({
      date: iso(d).slice(0, 10),
      revenue: Math.round(revenue),
      forecast: Math.round(expected),
      lower: Math.round(expected * 0.92),
      upper: Math.round(expected * 1.08),
      isAnomaly: anomaly,
    });
  }
  return points;
}

export const revenueSeries = buildRevenueSeries();

// ---------------------------------------------------------------- overview

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const last30 = revenueSeries.slice(-30).map((p) => p.revenue);
const prev30 = revenueSeries.slice(-60, -30).map((p) => p.revenue);

export const overview = {
  generatedAt: iso(ANCHOR),
  kpis: [
    {
      key: 'revenue',
      label: 'Revenue (30d)',
      value: sum(last30),
      unit: 'currency',
      delta: sum(last30) / sum(prev30) - 1,
      spark: last30,
    },
    {
      key: 'conversion',
      label: 'Checkout conversion',
      value: 0.0314,
      unit: 'percent',
      delta: -0.082,
      spark: [3.42, 3.45, 3.39, 3.47, 3.44, 3.5, 3.41, 3.12, 2.71, 2.64, 2.69, 2.93, 3.18, 3.14],
    },
    {
      key: 'anomalies',
      label: 'Open anomalies',
      value: 7,
      unit: 'count',
      delta: 0.4,
      spark: [2, 3, 2, 4, 3, 3, 5, 6, 7, 7, 6, 7, 7, 7],
    },
    {
      key: 'mttr',
      label: 'Time to root cause',
      value: 23,
      unit: 'minutes',
      delta: -0.37,
      spark: [61, 55, 52, 48, 44, 41, 39, 35, 33, 31, 28, 26, 24, 23],
    },
  ],
};

// ---------------------------------------------------------------- segments

export const revenueBySegment = [
  { segment: 'Enterprise', current: 2_480_000, previous: 2_310_000 },
  { segment: 'Mid-market', current: 1_720_000, previous: 1_690_000 },
  { segment: 'SMB', current: 980_000, previous: 1_140_000 },
  { segment: 'Self-serve', current: 610_000, previous: 702_000 },
];

export const channelMix = [
  { channel: 'Direct', share: 0.38 },
  { channel: 'Organic search', share: 0.27 },
  { channel: 'Paid', share: 0.19 },
  { channel: 'Partners', share: 0.16 },
];

/** Anomaly intensity per metric x weekday (z-score magnitude), for a heatmap. */
export const anomalyHeatmap = (() => {
  const rand = mulberry32(7);
  const metrics = ['Revenue', 'Conversion', 'Latency p95', 'Churn', 'Refunds', 'Signups'];
  const days = 14;
  return {
    metrics,
    days: Array.from({ length: days }, (_, i) => iso(daysAgo(days - 1 - i)).slice(0, 10)),
    cells: metrics.map((m, mi) =>
      Array.from({ length: days }, (_, di) => {
        const base = rand() * 1.4;
        const hot = (mi <= 2 && di >= 4 && di <= 7) || (mi === 4 && di >= 6 && di <= 9);
        return Number((hot ? 2.6 + rand() * 1.4 : base).toFixed(2));
      }),
    ),
  };
})();

// ---------------------------------------------------------------- anomalies

export const anomalies = [
  {
    id: 'an-1042',
    metric: 'Checkout conversion',
    severity: 'critical',
    zScore: -4.7,
    change: -0.226,
    detectedAt: iso(daysAgo(9, 14)),
    segment: 'Mobile web · EU',
  },
  {
    id: 'an-1041',
    metric: 'API latency p95',
    severity: 'serious',
    zScore: 3.9,
    change: 0.61,
    detectedAt: iso(daysAgo(9, 13)),
    segment: 'payments-svc',
  },
  {
    id: 'an-1039',
    metric: 'Refund rate',
    severity: 'serious',
    zScore: 3.2,
    change: 0.34,
    detectedAt: iso(daysAgo(7, 10)),
    segment: 'SMB',
  },
  {
    id: 'an-1036',
    metric: 'Self-serve signups',
    severity: 'warning',
    zScore: -2.6,
    change: -0.13,
    detectedAt: iso(daysAgo(4, 8)),
    segment: 'Organic search',
  },
  {
    id: 'an-1033',
    metric: 'Support ticket volume',
    severity: 'warning',
    zScore: 2.4,
    change: 0.18,
    detectedAt: iso(daysAgo(2, 16)),
    segment: 'Billing',
  },
];

// ---------------------------------------------------------------- agents

export const agents = [
  { type: AgentType.COORDINATOR, name: 'Coordinator', status: 'BUSY', tasks: 128, successRate: 0.98, avgMs: 2100 },
  { type: AgentType.ANALYTICS, name: 'Analytics', status: 'BUSY', tasks: 412, successRate: 0.97, avgMs: 5400 },
  { type: AgentType.FINANCE, name: 'Finance', status: 'IDLE', tasks: 176, successRate: 0.96, avgMs: 3800 },
  { type: AgentType.CUSTOMER, name: 'Customer', status: 'BUSY', tasks: 233, successRate: 0.94, avgMs: 4600 },
  { type: AgentType.PRODUCT, name: 'Product', status: 'IDLE', tasks: 141, successRate: 0.95, avgMs: 4100 },
  { type: AgentType.OPERATIONS, name: 'Operations', status: 'BUSY', tasks: 198, successRate: 0.93, avgMs: 6200 },
];

const BOOT = new Date();
export const dataSources = [
  { name: 'warehouse-prod', type: 'POSTGRESQL', status: 'CONNECTED', tables: 214, lastSyncedAt: iso(minutesAfter(BOOT, -4)) },
  { name: 'stripe-billing', type: 'REST_API', status: 'CONNECTED', tables: 18, lastSyncedAt: iso(minutesAfter(BOOT, -11)) },
  { name: 'product-events', type: 'POSTGRESQL', status: 'CONNECTED', tables: 46, lastSyncedAt: iso(minutesAfter(BOOT, -2)) },
  { name: 'helix-platform', type: 'GITHUB', status: 'CONNECTED', tables: 6, lastSyncedAt: iso(minutesAfter(BOOT, -38)) },
  { name: 'zendesk-export.csv', type: 'CSV', status: 'ERROR', tables: 1, lastSyncedAt: iso(daysAgo(3, 7)) },
];

// ---------------------------------------------------------------- investigations

interface Finding {
  agentType: AgentType;
  analyticsType: AnalyticsType;
  statement: string;
  confidence: number;
  isRootCause: boolean;
  evidence: string[];
}
interface Recommendation {
  priority: RecommendationPriority;
  action: string;
  expectedImpact: string;
}

const inv = (
  n: number,
  question: string,
  triggerType: InvestigationTriggerType,
  status: InvestigationStatus,
  createdDaysAgo: number,
  extra: {
    summary?: string;
    confidence?: number;
    durationMin?: number;
    plan?: { order: number; agentType: AgentType; objective: string; dependsOn: number[] }[];
    findings?: Finding[];
    recommendations?: Recommendation[];
  } = {},
) => {
  const createdAt = daysAgo(createdDaysAgo, createdDaysAgo === 0 ? 7 : 8 + (n % 9));
  const started = status === InvestigationStatus.PENDING ? null : minutesAfter(createdAt, 1);
  const done =
    started &&
    [InvestigationStatus.COMPLETED, InvestigationStatus.PARTIALLY_COMPLETED, InvestigationStatus.FAILED].includes(
      status,
    )
      ? minutesAfter(started, extra.durationMin ?? 18)
      : null;
  return {
    id: `0b7e4c1a-5d2f-4a8e-9c3b-${String(1000 + n).padStart(12, '0')}`,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    createdByUserId: null,
    triggerType,
    question,
    status,
    plan: extra.plan ? { steps: extra.plan } : null,
    rootCauseFindingId: null,
    summary: extra.summary ?? null,
    overallConfidence: extra.confidence ?? null,
    startedAt: started && iso(started),
    completedAt: done && iso(done),
    createdAt: iso(createdAt),
    updatedAt: iso(done ?? started ?? createdAt),
    findings: extra.findings ?? [],
    recommendations: extra.recommendations ?? [],
  };
};

const { ANALYTICS, FINANCE, CUSTOMER, PRODUCT, OPERATIONS, COORDINATOR } = AgentType;
const S = InvestigationStatus;
const T = InvestigationTriggerType;

export const investigations = [
  inv(1, 'Why did checkout conversion drop 22% in EU mobile last week?', T.ANOMALY_DETECTED, S.COMPLETED, 9, {
    confidence: 0.91,
    durationMin: 23,
    summary:
      'The drop is explained by a payments-svc release (v4.18.0) that raised p95 latency on 3-D Secure challenges from 1.2s to 3.4s for EU card issuers. Mobile web sessions abandoned at the authentication step at 2.6× the baseline rate. Rolling back on day 6 restored conversion to within 3% of forecast.',
    plan: [
      { order: 1, agentType: ANALYTICS, objective: 'Decompose the conversion drop by device, region, and funnel step', dependsOn: [] },
      { order: 2, agentType: OPERATIONS, objective: 'Correlate with deploys and service latency in the window', dependsOn: [] },
      { order: 3, agentType: CUSTOMER, objective: 'Check support tickets and session replays for checkout friction', dependsOn: [1] },
      { order: 4, agentType: FINANCE, objective: 'Quantify revenue impact against forecast', dependsOn: [1] },
      { order: 5, agentType: COORDINATOR, objective: 'Rank hypotheses and assemble the evidence trail', dependsOn: [2, 3, 4] },
    ],
    findings: [
      {
        agentType: OPERATIONS,
        analyticsType: AnalyticsType.DIAGNOSTIC,
        statement: 'payments-svc v4.18.0 raised 3-D Secure p95 latency from 1.2s to 3.4s for EU issuers.',
        confidence: 0.93,
        isRootCause: true,
        evidence: ['Deploy log 2026-10-05 13:42 UTC', 'APM trace sample (n=18,204)', 'Change-point at t=13:47, p<0.001'],
      },
      {
        agentType: ANALYTICS,
        analyticsType: AnalyticsType.DIAGNOSTIC,
        statement: '84% of the conversion loss is concentrated in mobile web, EU, at the payment-authentication step.',
        confidence: 0.95,
        isRootCause: false,
        evidence: ['Funnel decomposition (Shapley)', 'Segment contribution table'],
      },
      {
        agentType: FINANCE,
        analyticsType: AnalyticsType.DESCRIPTIVE,
        statement: 'Estimated revenue shortfall of $214k against forecast over four days.',
        confidence: 0.88,
        isRootCause: false,
        evidence: ['Prophet forecast, 90-day fit, MAPE 2.9%'],
      },
      {
        agentType: CUSTOMER,
        analyticsType: AnalyticsType.DIAGNOSTIC,
        statement: 'Tickets mentioning "payment stuck" rose 3.1× in the same window.',
        confidence: 0.81,
        isRootCause: false,
        evidence: ['Zendesk tag frequency', '41 session replays sampled'],
      },
    ],
    recommendations: [
      { priority: RecommendationPriority.CRITICAL, action: 'Add a latency SLO gate on 3-DS challenge time to the payments-svc deploy pipeline', expectedImpact: 'Blocks recurrence; est. $50k/day at risk' },
      { priority: RecommendationPriority.HIGH, action: 'Fall back to frictionless flow when challenge latency exceeds 2s', expectedImpact: '+0.4pp conversion on EU mobile' },
      { priority: RecommendationPriority.MEDIUM, action: 'Re-engage the 3,812 abandoned carts with a reminder email', expectedImpact: 'Recover ~$38k' },
    ],
  }),
  inv(2, 'What is driving the rise in SMB refund requests?', T.ANOMALY_DETECTED, S.IN_PROGRESS, 1, {
    plan: [
      { order: 1, agentType: FINANCE, objective: 'Break down refunds by plan, reason code, and cohort', dependsOn: [] },
      { order: 2, agentType: PRODUCT, objective: 'Check recent pricing and packaging changes', dependsOn: [] },
      { order: 3, agentType: CUSTOMER, objective: 'Cluster refund-request free text', dependsOn: [1] },
    ],
  }),
  inv(3, 'Forecast Q4 enterprise revenue and flag at-risk renewals', T.SCHEDULED, S.COMPLETED, 3, {
    confidence: 0.84,
    durationMin: 31,
    summary:
      'Q4 enterprise revenue is forecast at $7.6M (80% interval $7.2M–$8.0M), +7.4% QoQ. Eleven renewals worth $1.3M ARR show elevated churn risk, driven by falling weekly active seats.',
  }),
  inv(4, 'Why are self-serve signups from organic search down 13%?', T.ANOMALY_DETECTED, S.PLANNING, 0),
  inv(5, 'Which onboarding step loses the most new SMB accounts?', T.USER_QUESTION, S.COMPLETED, 5, {
    confidence: 0.89,
    durationMin: 14,
    summary: 'The data-connection step loses 38% of new SMB accounts; accounts that connect a source on day 1 retain at 2.3× the rate.',
  }),
  inv(6, 'Is the support backlog affecting NPS for billing customers?', T.USER_QUESTION, S.PARTIALLY_COMPLETED, 6, {
    confidence: 0.62,
    durationMin: 27,
    summary: 'A moderate correlation (ρ = 0.48) between first-response time and NPS detractors; survey coverage was too thin to attribute causation.',
  }),
  inv(7, 'Monthly margin review — infrastructure cost per customer', T.SCHEDULED, S.COMPLETED, 12, {
    confidence: 0.93,
    durationMin: 11,
    summary: 'Infrastructure cost per customer fell 6% MoM after storage-tier migration; GPU inference spend is the fastest-growing line item.',
  }),
  inv(8, 'Did the September pricing change cannibalise the Pro tier?', T.USER_QUESTION, S.AWAITING_EVIDENCE, 2),
  inv(9, 'Explain the latency spike on payments-svc', T.ANOMALY_DETECTED, S.COMPLETED, 9, {
    confidence: 0.95,
    durationMin: 9,
    summary: 'Linked to the v4.18.0 release; see the checkout conversion investigation.',
  }),
  inv(10, 'Churn drivers for annual-plan customers in APAC', T.MANUAL, S.FAILED, 15, {
    durationMin: 4,
    summary: 'Failed: the APAC CRM export was missing the renewal-date column.',
  }),
];

/** Investigations completed per day over the last 14 days, split by trigger. */
export const throughput = Array.from({ length: 14 }, (_, i) => {
  const rand = mulberry32(100 + i);
  const d = daysAgo(13 - i);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const scale = weekend ? 0.4 : 1;
  return {
    date: iso(d).slice(0, 10),
    anomaly: Math.round((3 + rand() * 4 + (i >= 4 && i <= 7 ? 5 : 0)) * scale),
    question: Math.round((4 + rand() * 5) * scale),
    scheduled: Math.round(2 + rand() * 2),
  };
});
