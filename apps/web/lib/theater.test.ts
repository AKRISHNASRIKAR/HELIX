import { describe, expect, it } from 'vitest';
import type { InvestigationTrace } from './api';
import {
  BEAT_WEIGHT,
  MIDDLE_MAX_MS,
  beatsBetween,
  buildStageLayout,
  buildTimeline,
  nodePan,
  pointAlong,
  rootCauseTiles,
  stageAt,
  transportLabel,
  type RootCauseTile,
  type TileKey,
} from './theater';
import { REAL_TRACE } from './theater.fixture';

const clone = (): InvestigationTrace => JSON.parse(JSON.stringify(REAL_TRACE));

describe('buildStageLayout', () => {
  it('puts the Coordinator at both ends of the rail and agents below in plan order', () => {
    const layout = buildStageLayout(REAL_TRACE);
    const roles = layout.nodes.map((n) => n.role);
    expect(roles[0]).toBe('plan');
    expect(roles[roles.length - 1]).toBe('synth');
    const agents = layout.nodes.filter((n) => n.role === 'agent');
    expect(agents.map((n) => n.label)).toEqual(['Analytics', 'Finance', 'Customer', 'Product']);
    expect(agents[0]!.wave).toBe(0);
    expect(new Set(agents.slice(1).map((n) => n.wave))).toEqual(new Set([1]));
    // Analytics runs first, so it sits on its own row above the parallel wave.
    expect(agents[0]!.y).toBeLessThan(agents[1]!.y);
    // Positions increase left to right.
    const xs = agents.map((n) => n.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Analytics feeds each wave-2 agent.
    expect(layout.dependencies).toHaveLength(3);
    for (const a of agents) {
      expect(layout.requestPath[a.key]).toHaveLength(3);
      expect(layout.resultPath[a.key]).toHaveLength(3);
    }
  });

  it('copes with a trace without steps or tasks', () => {
    const t = clone();
    t.steps = [];
    t.tasks = [];
    const layout = buildStageLayout(t);
    expect(layout.nodes.map((n) => n.role)).toEqual(['plan', 'synth']);
    expect(layout.dependencies).toEqual([]);
  });
});

describe('pointAlong', () => {
  it('walks a polyline by length', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(pointAlong(pts, 0)).toEqual([0, 0]);
    expect(pointAlong(pts, 0.25)).toEqual([5, 0]);
    expect(pointAlong(pts, 0.75)).toEqual([10, 5]);
    expect(pointAlong(pts, 2)).toEqual([10, 10]);
    expect(pointAlong([], 0.5)).toEqual([0, 0]);
  });
});

describe('buildTimeline (real trace)', () => {
  const tl = buildTimeline(REAL_TRACE);

  it('lasts a watchable 15 to 25 seconds', () => {
    expect(tl.total).toBeGreaterThanOrEqual(15_000);
    expect(tl.total).toBeLessThanOrEqual(25_000);
    expect(tl.complete).toBe(true);
    expect(tl.realTotal).toBeGreaterThan(1000);
    expect(tl.realTotal).toBeLessThan(3000);
  });

  it('starts with the question and plan and ends with synthesis and the root cause', () => {
    const kinds = tl.beats.map((b) => b.kind);
    expect(kinds.slice(0, 2)).toEqual(['question', 'plan']);
    expect(kinds.slice(-2)).toEqual(['synthesize', 'rootCause']);
    expect(tl.revealAt).toBe(tl.synthAt! + BEAT_WEIGHT.synthesize);
    expect(tl.rootCause?.isRootCause).toBe(true);
    expect(tl.confidence).toBeCloseTo(0.9519);
  });

  it('is sorted by theater time and keeps the agent section inside its window', () => {
    for (let i = 1; i < tl.beats.length; i++) expect(tl.beats[i]!.at).toBeGreaterThanOrEqual(tl.beats[i - 1]!.at);
    const middle = tl.beats.filter((b) => !['question', 'plan', 'synthesize', 'rootCause'].includes(b.kind));
    const span = tl.synthAt! - middle[0]!.at;
    expect(span).toBeLessThanOrEqual(MIDDLE_MAX_MS + 500);
  });

  it('carries every real A2A message with its transport', () => {
    const msgs = tl.beats.filter((b) => b.kind === 'dispatch' || b.kind === 'result');
    expect(msgs).toHaveLength(REAL_TRACE.messages.length);
    expect(msgs.every((b) => b.transport === 'a2a-gateway')).toBe(true);
    const analytics = REAL_TRACE.tasks.find((t) => t.agentType === 'ANALYTICS')!;
    const first = msgs[0]!;
    expect(first.kind).toBe('dispatch');
    expect(first.node).toBe(analytics.id);
    const result = msgs.find((b) => b.kind === 'result' && b.node === analytics.id)!;
    expect(result.detail).toBe('6 findings');
  });

  it('runs Analytics before the parallel wave', () => {
    const starts = tl.beats.filter((b) => b.kind === 'agentStart' && b.agentType !== 'COORDINATOR');
    expect(starts[0]!.agentType).toBe('ANALYTICS');
    const analyticsDone = tl.beats.find((b) => b.kind === 'agentDone' && b.agentType === 'ANALYTICS')!;
    for (const s of starts.slice(1)) expect(s.at).toBeGreaterThan(analyticsDone.at);
  });

  it('shows what the context engine handed each agent', () => {
    const ctx = tl.beats.filter((b) => b.kind === 'context');
    expect(ctx).toHaveLength(REAL_TRACE.contextSnapshots.length);
    const customer = ctx.find((b) => b.agentType === 'CUSTOMER')!;
    expect(customer.context?.tables).toContain('orders');
    expect(customer.context?.focusDays).toEqual(['2026-10-08']);
    expect(customer.context?.tokenCount).toBe(7966);
  });

  it('plays every evidence item and every non-root finding once', () => {
    expect(tl.beats.filter((b) => b.kind === 'evidence')).toHaveLength(REAL_TRACE.evidence.length);
    expect(tl.evidenceTotal).toBe(REAL_TRACE.evidence.length);
    expect(tl.findingTotal).toBe(REAL_TRACE.findings.length - 1);
    const ids = tl.beats.filter((b) => b.kind === 'finding').map((b) => b.finding!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(REAL_TRACE.investigation.rootCauseFindingId);
  });

  it('builds chapters for the plan, each wave and the climax', () => {
    expect(tl.chapters.map((c) => c.title)).toEqual([
      'The question',
      'Coordinator makes a plan',
      'Analytics goes first',
      'Finance, Customer and Product dig in, in parallel',
      'Coordinator weighs the evidence',
      'Root cause',
    ]);
  });
});

describe('stageAt', () => {
  const tl = buildTimeline(REAL_TRACE);
  const analytics = REAL_TRACE.tasks.find((t) => t.agentType === 'ANALYTICS')!.id;

  it('starts idle and ends with every agent done and all evidence counted', () => {
    const start = stageAt(tl, 0);
    expect(start.phase).toBe('intro');
    expect(Object.values(start.nodes).every((s) => s === 'idle')).toBe(true);
    const end = stageAt(tl, tl.total);
    expect(end.phase).toBe('reveal');
    expect(Object.values(end.nodes).every((s) => s === 'done')).toBe(true);
    expect(end.evidenceCount).toBe(REAL_TRACE.evidence.length);
    expect(end.findings).toHaveLength(tl.findingTotal);
    expect(end.realMs).toBe(tl.realTotal);
  });

  it('lights an agent while it runs and moves its request packet', () => {
    const start = tl.beats.find((b) => b.kind === 'agentStart' && b.node === analytics)!;
    expect(stageAt(tl, start.at).nodes[analytics]).toBe('running');
    const dispatch = tl.beats.find((b) => b.kind === 'dispatch' && b.node === analytics)!;
    const mid = stageAt(tl, dispatch.at + dispatch.duration / 2);
    expect(mid.packets.map((p) => p.beat.id)).toContain(dispatch.id);
    expect(mid.packets.find((p) => p.beat.id === dispatch.id)!.progress).toBeCloseTo(0.5);
  });

  it('pulses the Coordinator during synthesis', () => {
    const s = stageAt(tl, tl.synthAt! + 10);
    expect(s.phase).toBe('synth');
    expect(s.nodes.synth).toBe('running');
  });

  it('shows the live state of an unfinished run without the climax', () => {
    const t = clone();
    t.investigation.status = 'IN_PROGRESS';
    t.investigation.completedAt = null;
    const finance = t.tasks.find((x) => x.agentType === 'FINANCE')!;
    finance.status = 'RUNNING';
    finance.completedAt = null;
    t.tasks = t.tasks.filter((x) => x.agentType !== 'COORDINATOR');
    const live = buildTimeline(t);
    expect(live.complete).toBe(false);
    expect(live.revealAt).toBeNull();
    const s = stageAt(live, live.total);
    expect(s.nodes[finance.id]).toBe('running');
    expect(s.nodes[analytics]).toBe('done');
  });
});

describe('beatsBetween and nodePan', () => {
  const tl = buildTimeline(REAL_TRACE);
  it('returns beats crossed by the clock', () => {
    expect(beatsBetween(tl, -1, 0).map((b) => b.kind)).toEqual(['question']);
    expect(beatsBetween(tl, 10, 5)).toEqual([]);
  });
  it('pans left for the plan node and right for synthesis', () => {
    expect(nodePan(tl.layout, 'plan')).toBeLessThan(0);
    expect(nodePan(tl.layout, 'synth')).toBeGreaterThan(0);
    expect(nodePan(tl.layout, null)).toBe(0);
  });
});

describe('rootCauseTiles', () => {
  it('derives What / When / Where / Why from the real evidence', () => {
    const tiles = rootCauseTiles(REAL_TRACE);
    expect(tiles.map((t) => t.key)).toEqual(['what', 'when', 'where', 'why']);
    const by = Object.fromEntries(tiles.map((t) => [t.key, t])) as Record<TileKey, RootCauseTile>;
    expect(by.what.value).toBe('Revenue -38.8%');
    expect(by.what.detail).toBe('$19,944.04 against an expected $32,565.75');
    expect(by.when.value).toBe('Thursday 2026-10-08');
    expect(by.when.detail).toBe('Starting around 08:40 UTC');
    expect(by.where.value).toBe('channel = web');
    expect(by.where.detail).toBe('-82.9% on the day, more than the entire shortfall');
    expect(by.why.value).toBe('web-checkout v2.14.0');
    expect(by.why.detail).toBe('Deployed at 08:40 UTC, later rolled back');
  });

  it('leaves tiles out when their evidence is missing', () => {
    const t = clone();
    t.evidence = t.evidence.filter((e) => (e.data as { kind?: string }).kind !== 'event_alignment');
    expect(rootCauseTiles(t).map((x) => x.key)).toEqual(['what', 'when', 'where']);
    t.findings = t.findings.map((f) => ({ ...f, isRootCause: false }));
    t.investigation.rootCauseFindingId = null;
    expect(rootCauseTiles(t)).toEqual([]);
  });
});

describe('transportLabel', () => {
  it('names the transport', () => {
    expect(transportLabel('a2a-gateway')).toBe('A2A gateway');
    expect(transportLabel('in-process (gateway down)')).toBe('in-process');
    expect(transportLabel(null)).toBeNull();
  });
});
