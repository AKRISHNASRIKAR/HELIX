import { randomUUID } from 'node:crypto';
import { buildTrace, TraceInput } from './trace';

const t0 = new Date('2026-10-14T09:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);

/** Analytics -> Finance in parallel -> Coordinator synthesis, with a root cause. */
function input(): TraceInput {
  const id = () => randomUUID();
  const inv = id();
  const [s0, s1, s2] = [id(), id(), id()];
  const [tA, tF, tC] = [id(), id(), id()];
  const [eA, eSeg, eF, eRank] = [id(), id(), id(), id()];
  const [fA, fF, fRoot] = [id(), id(), id()];
  const rec = id();
  const snapA = id();
  const task = (tid: string, step: string, agentType: string, start: number, end: number) => ({
    id: tid,
    investigationStepId: step,
    agentType,
    status: 'SUCCEEDED',
    objective: `${agentType} work`,
    error: null,
    result: { ok: true },
    startedAt: at(start),
    completedAt: at(end),
    createdAt: at(start),
  });
  const ev = (eid: string, tid: string, summary: string) => ({
    id: eid,
    agentTaskId: tid,
    sourceType: 'METRIC',
    source: { description: 'engine' },
    summary,
    data: { kind: 'segment' },
    confidence: 0.9,
    collectedAt: at(1),
  });
  return {
    investigation: {
      id: inv,
      question: 'Why did revenue drop last week?',
      status: 'COMPLETED',
      triggerType: 'USER_QUESTION',
      triggerContext: null,
      summary: 's',
      overallConfidence: 0.91,
      rootCauseFindingId: fRoot,
      plan: { steps: [], reasoning: 'rules' },
      createdAt: t0,
      startedAt: t0,
      completedAt: at(9),
      monitor: null,
    },
    steps: [
      { id: s2, order: 2, agentType: 'COORDINATOR', objective: 'Synthesize', dependsOn: [0, 1] },
      { id: s0, order: 0, agentType: 'ANALYTICS', objective: 'Analyze', dependsOn: [] },
      { id: s1, order: 1, agentType: 'FINANCE', objective: 'Refunds', dependsOn: [0] },
    ],
    tasks: [
      task(tA, s0, 'ANALYTICS', 0, 2),
      task(tF, s1, 'FINANCE', 2, 5),
      task(tC, s2, 'COORDINATOR', 5, 6),
    ],
    evidence: [
      ev(eA, tA, 'Revenue anomaly'),
      ev(eSeg, tA, 'Drop in web'),
      ev(eF, tF, 'Web orders collapsed'),
      ev(eRank, tC, 'Root cause ranking'),
    ],
    findings: [
      {
        id: fRoot,
        agentType: 'COORDINATOR',
        analyticsType: 'DIAGNOSTIC',
        statement: 'Revenue dropped because web checkout broke',
        confidence: 0.91,
        isRootCause: true,
        evidenceIds: [eA, eSeg, eF, eRank],
      },
      {
        id: fA,
        agentType: 'ANALYTICS',
        analyticsType: 'DIAGNOSTIC',
        statement: 'Concentrated in web',
        confidence: 0.8,
        isRootCause: false,
        evidenceIds: [eA, eSeg],
      },
      {
        id: fF,
        agentType: 'FINANCE',
        analyticsType: 'DIAGNOSTIC',
        statement: 'x'.repeat(300),
        confidence: 0.7,
        isRootCause: false,
        evidenceIds: [eF],
      },
    ],
    recommendations: [
      {
        id: rec,
        title: 'Investigate the web channel',
        description: 'd',
        priority: 'HIGH',
        expectedImpact: null,
        findingIds: [fRoot, fA],
      },
    ],
    messages: [
      {
        id: id(),
        type: 'TASK_REQUEST',
        agentTaskId: tA,
        fromAgent: 'COORDINATOR',
        toAgent: 'ANALYTICS',
        payload: {},
        correlationId: tA,
        createdAt: t0,
      },
    ],
    contextSnapshots: [
      {
        id: snapA,
        agentTaskId: tA,
        agentType: 'ANALYTICS',
        tokenCount: 300,
        createdAt: t0,
        assembledContext: {},
      },
    ],
    events: [
      { id: id(), type: 'investigation.created', payload: {}, createdAt: t0 },
      {
        id: id(),
        type: 'investigation.completed',
        payload: { meta: { planner: 'rules', llmCalls: 0 } },
        createdAt: at(9),
      },
    ],
  };
}

describe('buildTrace', () => {
  it('derives finding tasks, task ids, durations and meta', () => {
    const i = input();
    const trace = buildTrace(i);
    const [tA, tF, tC] = i.tasks;
    const [fRoot, fA, fF] = i.findings;

    expect(trace.steps.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(trace.meta).toEqual({ planner: 'rules', llmCalls: 0 });
    const byId = new Map(trace.findings.map((f) => [f.id, f.agentTaskId]));
    expect(byId.get(fRoot!.id)).toBe(tC!.id); // root cause -> synthesis task
    expect(byId.get(fA!.id)).toBe(tA!.id); // all evidence from one task
    expect(byId.get(fF!.id)).toBe(tF!.id);

    const analytics = trace.tasks.find((t) => t.id === tA!.id)!;
    expect(analytics).toMatchObject({
      stepId: i.steps[1]!.id,
      durationMs: 2000,
      contextSnapshotId: i.contextSnapshots[0]!.id,
      findingIds: [fA!.id],
      evidenceIds: [i.evidence[0]!.id, i.evidence[1]!.id],
    });
    expect(trace.tasks.find((t) => t.id === tC!.id)!.contextSnapshotId).toBeNull();
  });

  it('builds the evidence graph with typed nodes and edges', () => {
    const i = input();
    const { nodes, edges } = buildTrace(i).graph;
    const types = (t: string) => nodes.filter((n) => n.type === t).length;
    expect(types('question')).toBe(1);
    expect(types('step')).toBe(3);
    expect(types('task')).toBe(3);
    expect(types('evidence')).toBe(4);
    expect(types('finding')).toBe(2);
    expect(types('rootCause')).toBe(1);
    expect(types('recommendation')).toBe(1);

    const kinds = (k: string) => edges.filter((e) => e.kind === k).length;
    expect(kinds('plans')).toBe(3);
    expect(kinds('runs')).toBe(3);
    expect(kinds('collected')).toBe(4);
    expect(kinds('supports')).toBe(4 + 2 + 1);
    expect(kinds('justifies')).toBe(2);
    expect(edges).toContainEqual({
      from: i.tasks[2]!.id,
      to: i.investigation.rootCauseFindingId,
      kind: 'selected',
    });
    // Every edge points at real nodes; long labels are truncated.
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(nodes.find((n) => n.id === i.findings[2]!.id)!.label).toHaveLength(140);
  });

  it('links a Phase 5 root cause (no synthesis task) to its own task, else the question', () => {
    const i = input();
    i.tasks = i.tasks.filter((t) => t.agentType !== 'COORDINATOR');
    i.evidence = i.evidence.filter((e) => i.tasks.some((t) => t.id === e.agentTaskId));
    i.findings[0]!.evidenceIds = [i.evidence[0]!.id];
    const trace = buildTrace(i);
    expect(trace.findings[0]!.agentTaskId).toBe(i.tasks[0]!.id);
    expect(trace.graph.edges).toContainEqual({
      from: i.tasks[0]!.id,
      to: i.findings[0]!.id,
      kind: 'selected',
    });

    i.findings[0]!.evidenceIds = [];
    const bare = buildTrace(i);
    expect(bare.graph.edges).toContainEqual({
      from: i.investigation.id,
      to: i.findings[0]!.id,
      kind: 'selected',
    });
    expect(bare.meta).toEqual({ planner: 'rules', llmCalls: 0 });
  });
});
