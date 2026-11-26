import { describe, expect, it } from 'vitest';
import type { InvestigationTrace, TraceMessage, TraceTask } from './api';
import {
  buildGraphData,
  buildReplaySteps,
  computeWaves,
  contributingFindings,
  deriveGraph,
  entityId,
  formatMs,
  messagesForTask,
  plannerLabel,
  readSnapshot,
  recommendationFindings,
  snapshotForTask,
  triggerContextRows,
} from './trace';

const task = (id: string, stepId: string, agentType: string, startedAt: string, completedAt: string, extra: Partial<TraceTask> = {}): TraceTask => ({
  id,
  stepId,
  agentType,
  status: 'SUCCEEDED',
  objective: `${agentType} objective`,
  error: null,
  startedAt,
  completedAt,
  durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  contextSnapshotId: null,
  findingIds: [],
  evidenceIds: [],
  ...extra,
});

const msg = (id: string, type: string, taskId: string, to: string, at: string, payload: Record<string, unknown> = {}): TraceMessage => ({
  id,
  type,
  agentTaskId: taskId,
  fromAgent: type === 'TASK_REQUEST' ? 'COORDINATOR' : to,
  toAgent: type === 'TASK_REQUEST' ? to : 'COORDINATOR',
  payload,
  correlationId: taskId,
  createdAt: at,
});

/** A trimmed version of the "Why did revenue drop last week?" run. */
function fixture(): InvestigationTrace {
  return {
    investigation: {
      id: 'inv',
      question: 'Why did revenue drop last week?',
      status: 'COMPLETED',
      triggerType: 'USER_QUESTION',
      triggerContext: null,
      summary: 'Revenue dropped because web checkout broke.',
      overallConfidence: 0.91,
      rootCauseFindingId: 'f-root',
      createdAt: '2026-11-26T10:00:00Z',
      startedAt: '2026-11-26T10:00:01Z',
      completedAt: '2026-11-26T10:00:20Z',
    },
    plan: { reasoning: 'Analytics first, then finance, customer and product.' },
    meta: { planner: 'rules', summaryWriter: 'rules', llmCalls: 0, llmErrors: [] },
    steps: [
      { id: 's0', order: 0, agentType: 'ANALYTICS', objective: 'Find the anomaly', dependsOn: [] },
      { id: 's1', order: 1, agentType: 'FINANCE', objective: 'Refunds', dependsOn: [0] },
      { id: 's2', order: 2, agentType: 'PRODUCT', objective: 'Deploys', dependsOn: [0] },
      { id: 's3', order: 3, agentType: 'COORDINATOR', objective: 'Synthesize', dependsOn: [0, 1, 2] },
    ],
    tasks: [
      task('t0', 's0', 'ANALYTICS', '2026-11-26T10:00:02Z', '2026-11-26T10:00:05Z', { findingIds: ['f-a'], evidenceIds: ['e-a'], contextSnapshotId: 'c0' }),
      task('t2', 's2', 'PRODUCT', '2026-11-26T10:00:06Z', '2026-11-26T10:00:12Z', { evidenceIds: ['e-p'] }),
      task('t1', 's1', 'FINANCE', '2026-11-26T10:00:06Z', '2026-11-26T10:00:09Z', { evidenceIds: ['e-f'] }),
      task('t3', 's3', 'COORDINATOR', '2026-11-26T10:00:13Z', '2026-11-26T10:00:14Z', { evidenceIds: ['e-r'] }),
    ],
    messages: [
      msg('m0', 'TASK_REQUEST', 't0', 'ANALYTICS', '2026-11-26T10:00:02Z', { objective: 'Find the anomaly', transport: 'a2a-gateway' }),
      msg('m1', 'TASK_RESULT', 't0', 'ANALYTICS', '2026-11-26T10:00:05Z', { status: 'SUCCEEDED', findings: 2, transport: 'a2a-gateway' }),
      msg('m2', 'TASK_REQUEST', 't1', 'FINANCE', '2026-11-26T10:00:06Z', { transport: 'a2a-gateway' }),
      msg('m3', 'TASK_REQUEST', 't2', 'PRODUCT', '2026-11-26T10:00:06Z', { transport: 'in-process' }),
      msg('m4', 'TASK_RESULT', 't1', 'FINANCE', '2026-11-26T10:00:09Z', { status: 'SUCCEEDED', findings: 1 }),
      { ...msg('m5', 'TASK_RESULT', 't2', 'PRODUCT', '2026-11-26T10:00:12Z', { findings: 1 }), agentTaskId: null },
    ],
    contextSnapshots: [
      {
        id: 'c0',
        agentTaskId: null,
        agentType: 'ANALYTICS',
        tokenCount: 1200,
        createdAt: '2026-11-26T10:00:02Z',
        assembledContext: {
          source: 'context-engine',
          truncated: true,
          focus: { anomalyDates: ['2026-10-08'], metricKeys: ['revenue'], direction: 'drop' },
          decisions: [{ rule: 'semantic_types', kept: ['orders'], dropped: ['deployments'], reason: 'no currency column' }, 'junk'],
          dataSources: [{ name: 'orders.csv', type: 'CSV', schemas: [{ tableName: 'orders' }] }],
          upstream: { findings: [], evidence: [] },
          history: { recentMetrics: [{}, {}], recentAnomalies: [], pastFindings: [{}] },
        },
      },
      { id: 'c1', agentTaskId: 't1', agentType: 'FINANCE', tokenCount: null, createdAt: '2026-11-26T10:00:06Z', assembledContext: { tokenCount: 900 } },
      { id: 'c2', agentTaskId: null, agentType: 'PRODUCT', tokenCount: 10, createdAt: '2026-11-26T10:00:06Z', assembledContext: { agentTaskId: 't2' } },
    ],
    events: [],
    evidence: [
      { id: 'e-a', agentTaskId: 't0', sourceType: 'ANOMALY', summary: 'Revenue anomaly on 2026-10-08', data: { kind: 'anomaly' }, confidence: 0.99 },
      { id: 'e-f', agentTaskId: 't1', sourceType: 'METRIC', summary: 'Web orders collapse', data: { kind: 'segment_volume' }, confidence: 0.9 },
      { id: 'e-p', agentTaskId: 't2', sourceType: 'API_RESPONSE', summary: 'web-checkout v2.14.0 deploy', data: { kind: 'event_alignment' }, confidence: 1 },
      { id: 'e-r', agentTaskId: 't3', sourceType: 'METRIC', summary: 'Root cause ranking', data: { kind: 'root_cause_ranking' }, confidence: 0.91 },
    ],
    findings: [
      { id: 'f-a', agentType: 'ANALYTICS', analyticsType: 'DIAGNOSTIC', statement: 'Revenue dropped 40% on 2026-10-08', confidence: 0.99, isRootCause: false, evidenceIds: ['e-a'], agentTaskId: 't0' },
      { id: 'f-f', agentType: 'FINANCE', analyticsType: 'DIAGNOSTIC', statement: 'Web orders fell to 26', confidence: 0.8, isRootCause: false, evidenceIds: ['e-f'], agentTaskId: 't1' },
      { id: 'f-p', agentType: 'PRODUCT', analyticsType: 'DIAGNOSTIC', statement: 'Deploy came before the drop', confidence: 0.9, isRootCause: false, evidenceIds: ['e-p'] },
      { id: 'f-x', agentType: 'CUSTOMER', analyticsType: 'DIAGNOSTIC', statement: 'Segments are not the driver', confidence: 0.7, isRootCause: false, evidenceIds: ['e-unknown'] },
      { id: 'f-root', agentType: 'COORDINATOR', analyticsType: 'DIAGNOSTIC', statement: 'Web checkout broke after the deploy', confidence: 0.91, isRootCause: true, evidenceIds: ['e-a', 'e-f', 'e-p', 'e-r'], agentTaskId: 't3' },
    ],
    recommendations: [
      { id: 'r1', title: 'Review the web-checkout v2.14.0 deploy', description: null, priority: 'CRITICAL', expectedImpact: null, findingIds: ['f-p', 'f-root', 'missing'] },
    ],
    graph: null,
  };
}

describe('formatMs / plannerLabel', () => {
  it('formats durations', () => {
    expect(formatMs(840)).toBe('840ms');
    expect(formatMs(12_300)).toBe('12.3s');
    expect(formatMs(125_000)).toBe('2m 05s');
    expect(formatMs(null)).toBeNull();
    expect(formatMs(-1)).toBeNull();
  });
  it('names the planner', () => {
    expect(plannerLabel({ planner: 'rules' })).toBe('Rules planner');
    expect(plannerLabel({ planner: 'llm', llmModel: 'claude-opus-5-5' })).toBe('LLM planner (claude-opus-5-5)');
    expect(plannerLabel({ planner: 'llm:claude-opus-5-5' })).toBe('LLM planner (claude-opus-5-5)');
    expect(plannerLabel(null)).toBe('Coordinator plan');
  });
});

describe('computeWaves', () => {
  it('puts independent steps in the same wave', () => {
    const waves = computeWaves(fixture().steps);
    expect([...waves.entries()].sort()).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
  });
  it('survives cycles and unknown dependencies', () => {
    const waves = computeWaves([
      { order: 0, dependsOn: [1] },
      { order: 1, dependsOn: [0] },
      { order: 2, dependsOn: [9] },
    ]);
    expect(waves.get(2)).toBe(0);
    expect(waves.size).toBe(3);
  });
});

describe('messagesForTask', () => {
  it('matches by agentTaskId or correlationId, in time order', () => {
    const t = fixture();
    expect(messagesForTask(t.messages, 't2').map((m) => m.id)).toEqual(['m3', 'm5']);
  });
});

describe('buildReplaySteps', () => {
  it('orders question, plan, waves with results, root cause, recommendations, summary', () => {
    const steps = buildReplaySteps(fixture());
    expect(steps.map((s) => s.id)).toEqual([
      'question',
      'plan',
      'wave-0',
      'task-t0',
      'wave-1',
      'task-t1',
      'task-t2',
      'wave-2',
      'task-t3',
      'findings',
      'root-cause',
      'recommendations',
      'summary',
    ]);
  });

  it('carries messages, transport, planner and findings on the right steps', () => {
    const steps = buildReplaySteps(fixture());
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get('plan')!.title).toBe('Rules planner');
    expect(byId.get('plan')!.description).toContain('Analytics first');
    const wave1 = byId.get('wave-1')!;
    expect(wave1.title).toBe('Wave 2: Finance, Product');
    expect(wave1.messages.map((m) => [m.id, m.transport])).toEqual([
      ['m2', 'a2a-gateway'],
      ['m3', 'in-process'],
    ]);
    expect(byId.get('task-t0')!.messages.map((m) => m.type)).toEqual(['TASK_RESULT']);
    expect(byId.get('task-t0')!.messages[0]!.detail).toBe('succeeded, 2 findings');
    expect(byId.get('task-t0')!.items.map((i) => i.id)).toEqual(['f-a']);
    // PRODUCT finding has no agentTaskId; it is placed via the task's findingIds or left as orphan.
    expect(byId.get('findings')!.items.map((i) => i.id)).toEqual(['f-p', 'f-x']);
    // Root cause is not repeated under the synthesis task.
    expect(byId.get('task-t3')!.items).toEqual([]);
    expect(byId.get('root-cause')!.title).toBe('Root cause (Coordinator synthesis)');
    expect(byId.get('root-cause')!.items.map((i) => i.id)).toEqual(['f-a', 'f-f', 'f-p']);
    expect(byId.get('summary')!.items[0]!.confidence).toBe(0.91);
  });

  it('describes an autonomous trigger', () => {
    const t = fixture();
    t.investigation.triggerType = 'ANOMALY_DETECTED';
    t.investigation.monitor = { id: 'mon', name: 'Daily revenue' };
    t.investigation.triggerContext = { metricName: 'Daily revenue', date: '2026-10-08', value: 60, expectedValue: 100 };
    const [first] = buildReplaySteps(t);
    expect(first!.title).toBe('Anomaly detected by monitor "Daily revenue"');
    expect(first!.items.find((i) => i.label === 'Change')?.detail).toBe('-40.0%');
  });

  it('handles an empty pending trace', () => {
    const t = fixture();
    Object.assign(t, { steps: [], tasks: [], messages: [], findings: [], recommendations: [], plan: null });
    t.investigation.summary = null;
    t.investigation.completedAt = null;
    t.investigation.rootCauseFindingId = null;
    expect(buildReplaySteps(t).map((s) => s.kind)).toEqual(['question']);
  });
});

describe('root cause helpers', () => {
  it('finds contributing findings through shared evidence', () => {
    expect(contributingFindings(fixture(), 'f-root').map((f) => f.id)).toEqual(['f-a', 'f-f', 'f-p']);
    expect(contributingFindings(fixture(), 'nope')).toEqual([]);
  });
  it('maps recommendations to the findings that justify them', () => {
    expect(recommendationFindings(fixture()).get('r1')!.map((f) => f.id)).toEqual(['f-p', 'f-root']);
  });
  it('renders trigger context rows defensively', () => {
    expect(triggerContextRows(null)).toEqual([]);
    const rows = triggerContextRows({ metricKey: 'revenue', severity: 'HIGH', deviationScore: -4.213 });
    expect(rows).toEqual([
      { label: 'Metric', value: 'revenue' },
      { label: 'Severity', value: 'high' },
      { label: 'Deviation', value: '-4.21' },
    ]);
  });
});

describe('graph data', () => {
  it('derives a graph when the API sends none', () => {
    const g = deriveGraph(fixture());
    expect(g.nodes.filter((n) => n.type === 'rootCause').map((n) => n.id)).toEqual(['finding:f-root']);
    expect(g.edges).toContainEqual({ from: 'question', to: 'step:s0', kind: 'plans' });
    expect(g.edges).toContainEqual({ from: 'step:s1', to: 'task:t1', kind: 'runs' });
    expect(g.edges).toContainEqual({ from: 'task:t2', to: 'evidence:e-p', kind: 'collected' });
    expect(g.edges).toContainEqual({ from: 'evidence:e-p', to: 'finding:f-root', kind: 'supports' });
    expect(g.edges).toContainEqual({ from: 'task:t3', to: 'finding:f-root', kind: 'selected' });
    expect(g.edges).toContainEqual({ from: 'finding:f-p', to: 'recommendation:r1', kind: 'justifies' });
    // Edges to unknown evidence/findings are never emitted.
    expect(g.edges.some((e) => e.from === 'evidence:e-unknown' || e.to === 'recommendation:missing')).toBe(false);
  });

  it('lays nodes out in columns by type with details, dropping dangling edges', () => {
    const t = fixture();
    t.graph = {
      nodes: [
        { id: 'q', type: 'question', label: 'Why?' },
        { id: 'f-root', type: 'rootCause', label: 'Web checkout broke', confidence: 0.91 },
        { id: 'e-a', type: 'evidence', label: 'Anomaly' },
        { id: 'e-p', type: 'evidence', label: 'Deploy' },
        { id: 'e-p', type: 'evidence', label: 'duplicate' },
        { id: 'bogus', type: 'mystery' as never, label: 'x' },
      ],
      edges: [
        { from: 'e-a', to: 'f-root', kind: 'supports' },
        { from: 'e-p', to: 'f-root', kind: 'supports' },
        { from: 'e-p', to: 'gone', kind: 'supports' },
      ],
    };
    const data = buildGraphData(t);
    expect(data.nodes.map((n) => n.id)).toEqual(['q', 'e-a', 'e-p', 'f-root']);
    expect(data.links).toHaveLength(2);
    expect(data.categories.map((c) => c.name)).toContain('Root cause');
    const ev = data.nodes.filter((n) => n.type === 'evidence');
    expect(ev.map((n) => n.y)).toEqual([-32, 32]);
    expect(ev[0]!.x).toBe(3 * 220);
    const root = data.nodes.find((n) => n.id === 'f-root')!;
    expect(root.detail.title).toBe('Web checkout broke after the deploy');
    expect(root.detail.confidence).toBe(0.91);
    expect(data.nodes.find((n) => n.id === 'e-a')!.detail.data).toEqual({ kind: 'anomaly' });
  });

  it('strips type prefixes from node ids', () => {
    expect(entityId('finding:abc')).toBe('abc');
    expect(entityId('abc')).toBe('abc');
  });
});

describe('snapshots', () => {
  it('matches snapshots to tasks by id, agentTaskId or the context itself', () => {
    const t = fixture();
    const byTask = (id: string) => snapshotForTask(t.contextSnapshots, t.tasks.find((x) => x.id === id)!)?.id ?? null;
    expect(byTask('t0')).toBe('c0');
    expect(byTask('t1')).toBe('c1');
    expect(byTask('t2')).toBe('c2');
    expect(byTask('t3')).toBeNull();
  });

  it('parses an assembled context defensively', () => {
    const t = fixture();
    const view = readSnapshot(t.contextSnapshots[0]!);
    expect(view.tokenCount).toBe(1200);
    expect(view.truncated).toBe(true);
    expect(view.focus).toEqual({ anomalyDates: ['2026-10-08'], metricKeys: ['revenue'], direction: 'drop' });
    expect(view.decisions).toEqual([
      { rule: 'semantic_types', kept: ['orders'], dropped: ['deployments'], reason: 'no currency column' },
    ]);
    expect(view.dataSources).toEqual([{ name: 'orders.csv', type: 'CSV', tables: ['orders'] }]);
    expect(view.history).toEqual({ metrics: 2, anomalies: 0, findings: 1 });
    expect(readSnapshot(t.contextSnapshots[1]!).tokenCount).toBe(900);
    const empty = readSnapshot({ ...t.contextSnapshots[0]!, tokenCount: null, assembledContext: 'garbage' });
    expect(empty.decisions).toEqual([]);
    expect(empty.tokenCount).toBeNull();
  });
});

describe('describeSource', () => {
  it('summarizes string and object sources', async () => {
    const { describeSource } = await import('./trace');
    expect(describeSource('analytics-engine')).toBe('analytics-engine');
    expect(describeSource({ engine: 'analytics-engine', endpoint: '/segments/compare' })).toBe('analytics-engine /segments/compare');
    expect(describeSource(null)).toBeNull();
  });
});
