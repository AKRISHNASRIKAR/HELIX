import type { InvestigationTrace, TraceEvidence, TraceFinding, TraceTask } from './api';
import type { Cue } from './sound';
import {
  agentLabel,
  computeWaves,
  formatMs,
  messageTransport,
  messagesForTask,
  readCulprit,
  readSnapshot,
  rootCauseFinding,
  snapshotForTask,
  type Culprit,
} from './trace';
import { isActiveStatus } from './investigations';

/**
 * Pure helpers for the "run theater": a slowed-down, cinematic playback of a
 * real investigation run. A run takes about a second end to end, so the real
 * trace (tasks, A2A messages, context snapshots, evidence, findings) is turned
 * into an ordered list of timed beats spread over roughly 15 to 25 seconds.
 * Every number shown on stage comes from the trace; only the pacing is made up.
 * No I/O and no React, so this is unit tested directly (lib/theater.test.ts).
 */

// ------------------------------------------------------------------ layout

/** Stage coordinate system (SVG viewBox units). */
export const STAGE_W = 1000;
export const STAGE_H = 470;
export const RAIL_Y = 64;
export const NODE_W = 172;
export const NODE_H = 66;

export type StageRole = 'plan' | 'agent' | 'synth';

export interface StageNode {
  /** Task id for agents, 'plan' / 'synth' for the Coordinator ends of the rail. */
  key: string;
  role: StageRole;
  agentType: string;
  label: string;
  wave: number;
  x: number;
  y: number;
  objective: string | null;
  /** Real task duration, e.g. "570ms". */
  duration: string | null;
  status: string | null;
}

export interface StageEdge {
  id: string;
  from: string;
  to: string;
  points: [number, number][];
}

export interface StageLayout {
  nodes: StageNode[];
  /** Upstream dependency curves between agents (SVG path data). */
  dependencies: { id: string; d: string }[];
  /** Polylines a TASK_REQUEST packet follows, by task key. */
  requestPath: Record<string, [number, number][]>;
  /** Polylines a TASK_RESULT packet follows, by task key. */
  resultPath: Record<string, [number, number][]>;
}

const isCoordinator = (agentType: string) => agentType.toUpperCase() === 'COORDINATOR';
const ms = (v: string | null | undefined): number | null => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Specialist tasks in plan order with their execution wave. */
function agentTasks(trace: InvestigationTrace): { task: TraceTask; wave: number; order: number }[] {
  const steps = trace.steps ?? [];
  const waves = computeWaves(steps);
  const stepById = new Map(steps.map((s) => [s.id, s]));
  return (trace.tasks ?? [])
    .filter((t) => !isCoordinator(t.agentType))
    .map((task) => {
      const step = task.stepId ? stepById.get(task.stepId) : undefined;
      return { task, wave: step ? (waves.get(step.order) ?? 0) : 0, order: step?.order ?? 999 };
    })
    .sort((a, b) => a.wave - b.wave || a.order - b.order);
}

/** The Coordinator's own synthesis task, when the plan has one. */
function synthTask(trace: InvestigationTrace): TraceTask | null {
  return (trace.tasks ?? []).find((t) => isCoordinator(t.agentType)) ?? null;
}

/**
 * Mission-control layout: the Coordinator is a rail across the top (plan at
 * the left end, synthesis at the right end); specialist agents hang below it
 * left to right in plan order, one row per execution wave, so "Analytics
 * first, then three in parallel" reads at a glance.
 */
export function buildStageLayout(trace: InvestigationTrace): StageLayout {
  const list = agentTasks(trace);
  const waveCount = Math.max(1, ...list.map((a) => a.wave + 1));
  const left = 220;
  const right = 800;
  const gapUnits = 0.5;
  const units = Math.max(0, list.length - 1) + (waveCount - 1) * gapUnits;
  const unit = units > 0 ? (right - left) / units : 0;
  const rowY = (wave: number) => (waveCount === 1 ? 230 : 196 + (wave * 150) / Math.max(1, waveCount - 1));

  const synth = synthTask(trace);
  const nodes: StageNode[] = [
    {
      key: 'plan',
      role: 'plan',
      agentType: 'COORDINATOR',
      label: 'Coordinator',
      wave: -1,
      x: 96,
      y: RAIL_Y,
      objective: 'Plans the investigation',
      duration: null,
      status: null,
    },
  ];
  let cursor = 0;
  let prevWave = list[0]?.wave ?? 0;
  for (const { task, wave } of list) {
    if (wave !== prevWave) cursor += gapUnits * (wave - prevWave);
    prevWave = wave;
    nodes.push({
      key: task.id,
      role: 'agent',
      agentType: task.agentType,
      label: agentLabel(task.agentType),
      wave,
      x: list.length === 1 ? (left + right) / 2 : Math.round(left + cursor * unit),
      y: rowY(wave),
      objective: task.objective,
      duration: formatMs(task.durationMs),
      status: task.status,
    });
    cursor += 1;
  }
  nodes.push({
    key: 'synth',
    role: 'synth',
    agentType: 'COORDINATOR',
    label: 'Coordinator',
    wave: waveCount,
    x: STAGE_W - 96,
    y: RAIL_Y,
    objective: 'Synthesizes the root cause',
    duration: formatMs(synth?.durationMs),
    status: synth?.status ?? null,
  });

  const byWave = new Map<number, StageNode[]>();
  for (const n of nodes) if (n.role === 'agent') byWave.set(n.wave, [...(byWave.get(n.wave) ?? []), n]);
  const dependencies: StageLayout['dependencies'] = [];
  for (const [wave, upper] of byWave) {
    const lower = byWave.get(wave + 1) ?? [];
    for (const a of upper) {
      for (const b of lower) {
        const y1 = a.y + NODE_H / 2;
        const y2 = b.y + NODE_H / 2;
        const dip = Math.max(y1, y2) + 70;
        dependencies.push({ id: `${a.key}-${b.key}`, d: `M ${a.x} ${y1} C ${a.x} ${dip}, ${b.x} ${dip}, ${b.x} ${y2}` });
      }
    }
  }

  const planRight = 96 + NODE_W / 2;
  const synthLeft = STAGE_W - 96 - NODE_W / 2;
  const requestPath: StageLayout['requestPath'] = {};
  const resultPath: StageLayout['resultPath'] = {};
  for (const n of nodes) {
    if (n.role !== 'agent') continue;
    const top = n.y - NODE_H / 2;
    requestPath[n.key] = [
      [planRight, RAIL_Y],
      [n.x, RAIL_Y],
      [n.x, top],
    ];
    resultPath[n.key] = [
      [n.x, top],
      [n.x, RAIL_Y],
      [synthLeft, RAIL_Y],
    ];
  }
  return { nodes, dependencies, requestPath, resultPath };
}

/** Point at `progress` (0..1) along a polyline, by length. */
export function pointAlong(points: [number, number][], progress: number): [number, number] {
  const first = points[0];
  if (!first) return [0, 0];
  const pairs = points.slice(1).map((p, i) => {
    const from = points[i] ?? first;
    return { from, to: p, len: Math.hypot(p[0] - from[0], p[1] - from[1]) };
  });
  const total = pairs.reduce((a, s) => a + s.len, 0);
  if (total === 0) return first;
  let dist = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < pairs.length; i++) {
    const seg = pairs[i]!;
    if (dist <= seg.len || i === pairs.length - 1) {
      const f = seg.len === 0 ? 0 : Math.min(1, dist / seg.len);
      return [seg.from[0] + (seg.to[0] - seg.from[0]) * f, seg.from[1] + (seg.to[1] - seg.from[1]) * f];
    }
    dist -= seg.len;
  }
  return points[points.length - 1] ?? first;
}

// ------------------------------------------------------------------- beats

export type BeatKind =
  | 'question'
  | 'plan'
  | 'context'
  | 'dispatch'
  | 'agentStart'
  | 'evidence'
  | 'finding'
  | 'agentDone'
  | 'result'
  | 'synthesize'
  | 'rootCause';

export interface TheaterContext {
  tables: string[];
  focusDays: string[];
  metrics: string[];
  direction: string | null;
  tokenCount: number | null;
  upstreamFindings: number;
}

export interface Beat {
  id: string;
  kind: BeatKind;
  /** Theater time in ms from the start of playback. */
  at: number;
  /** How long the beat's visual lasts on stage (packets, chips), in theater ms. */
  duration: number;
  /** Real ms since the investigation started, when known. */
  realAt: number | null;
  /** Stage node key ('plan', 'synth' or a task id). */
  node: string | null;
  agentType: string | null;
  label: string;
  detail: string | null;
  transport: string | null;
  status: string | null;
  finding: TraceFinding | null;
  evidence: TraceEvidence | null;
  context: TheaterContext | null;
  cue: Cue | null;
}

export interface Chapter {
  at: number;
  title: string;
}

export type TileKey = 'what' | 'when' | 'where' | 'why';
export interface RootCauseTile {
  key: TileKey;
  label: string;
  value: string;
  detail: string | null;
}

export interface Timeline {
  beats: Beat[];
  chapters: Chapter[];
  layout: StageLayout;
  /** End of playback (the reveal stays on screen after this). */
  total: number;
  synthAt: number | null;
  revealAt: number | null;
  /** Real run duration in ms (startedAt or createdAt to completedAt). */
  realTotal: number | null;
  complete: boolean;
  rootCause: TraceFinding | null;
  confidence: number | null;
  tiles: RootCauseTile[];
  /** Who shipped the change behind the root cause, and how to fix it (shown after the tiles). */
  culprit: Culprit | null;
  evidenceTotal: number;
  findingTotal: number;
}

/** Base theater durations (ms) per beat kind, before the middle section is scaled. */
export const BEAT_WEIGHT: Record<BeatKind, number> = {
  question: 1800,
  plan: 2000,
  context: 650,
  dispatch: 750,
  agentStart: 400,
  evidence: 260,
  finding: 720,
  agentDone: 260,
  result: 560,
  synthesize: 2600,
  rootCause: 4200,
};
const PACKET_MS = 1100;
const CONTEXT_CHIP_MS = 2600;
/** The agent section is squeezed or stretched to fit this window. */
export const MIDDLE_MIN_MS = 7000;
export const MIDDLE_MAX_MS = 14000;

const KIND_RANK: Record<BeatKind, number> = {
  question: 0,
  plan: 1,
  context: 2,
  dispatch: 3,
  agentStart: 4,
  evidence: 5,
  finding: 6,
  agentDone: 7,
  result: 8,
  synthesize: 9,
  rootCause: 10,
};

function contextFor(trace: InvestigationTrace, task: TraceTask): { ctx: TheaterContext; at: number | null } | null {
  const snap = snapshotForTask(trace.contextSnapshots ?? [], task);
  if (!snap) return null;
  const view = readSnapshot(snap);
  return {
    at: ms(snap.createdAt),
    ctx: {
      tables: [...new Set(view.dataSources.flatMap((d) => d.tables))],
      focusDays: view.focus.anomalyDates,
      metrics: view.focus.metricKeys,
      direction: view.focus.direction,
      tokenCount: view.tokenCount,
      upstreamFindings: view.upstream.findings,
    },
  };
}

/** Human transport label: "A2A gateway" / "in-process". */
export function transportLabel(transport: string | null | undefined): string | null {
  if (!transport) return null;
  if (transport === 'a2a-gateway') return 'A2A gateway';
  if (transport.startsWith('in-process')) return 'in-process';
  return transport;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface RawBeat extends Omit<Beat, 'id' | 'at' | 'duration'> {
  real: number;
  seq: number;
  visual: number;
}

/**
 * Turns a trace into the playback timeline. Intro beats (question, plan) and
 * the climax (synthesis, root cause) have fixed lengths; the agent section is
 * ordered by the real timestamps and scaled into MIDDLE_MIN_MS..MIDDLE_MAX_MS.
 */
export function buildTimeline(trace: InvestigationTrace): Timeline {
  const inv = trace.investigation;
  const layout = buildStageLayout(trace);
  const root = rootCauseFinding(trace);
  const origin = ms(inv.startedAt) ?? ms(inv.createdAt) ?? 0;
  const rel = (t: number | null) => (t == null ? null : Math.max(0, t - origin));
  const evidenceById = new Map((trace.evidence ?? []).map((e) => [e.id, e]));
  const nodeOf = (t: TraceTask) => (isCoordinator(t.agentType) ? 'synth' : t.id);
  const raw: RawBeat[] = [];
  let seq = 0;
  const push = (b: Omit<RawBeat, 'seq' | 'visual'> & { visual?: number }) =>
    raw.push({ visual: BEAT_WEIGHT[b.kind], ...b, seq: seq++ });
  const base = {
    detail: null,
    transport: null,
    status: null,
    finding: null,
    evidence: null,
    context: null,
  } as const;

  const tasks = trace.tasks ?? [];
  const messages = trace.messages ?? [];
  const placedEvidence = new Set<string>();
  for (const task of tasks) {
    const node = nodeOf(task);
    const name = isCoordinator(task.agentType) ? 'Coordinator' : agentLabel(task.agentType);
    const started = ms(task.startedAt);
    const completed = ms(task.completedAt);
    const c = contextFor(trace, task);
    if (c) {
      push({
        ...base,
        kind: 'context',
        real: c.at ?? started ?? origin,
        realAt: rel(c.at),
        node,
        agentType: task.agentType,
        label: `Context for ${name}`,
        context: c.ctx,
        cue: null,
        visual: CONTEXT_CHIP_MS,
      });
    }
    const taskMessages = messagesForTask(messages, task.id);
    for (const m of taskMessages) {
      const at = ms(m.createdAt) ?? started ?? origin;
      const transport = messageTransport(m);
      const request = m.type === 'TASK_REQUEST';
      const p = m.payload ?? {};
      push({
        ...base,
        kind: request ? 'dispatch' : 'result',
        real: at,
        realAt: rel(at),
        node,
        agentType: task.agentType,
        label: m.type,
        detail: request
          ? typeof p.objective === 'string'
            ? p.objective
            : null
          : typeof p.error === 'string'
            ? p.error
            : typeof p.findings === 'number'
              ? plural(p.findings, 'finding')
              : null,
        transport,
        status: typeof p.status === 'string' ? p.status : null,
        cue: 'message',
        visual: PACKET_MS,
      });
    }
    if (started != null || completed != null) {
      push({
        ...base,
        kind: 'agentStart',
        real: started ?? completed!,
        realAt: rel(started ?? completed),
        node,
        agentType: task.agentType,
        label: `${name} starts`,
        detail: task.objective,
        transport: isCoordinator(task.agentType) ? 'in-process' : null,
        cue: 'agentStart',
      });
    }
    const evidence = (task.evidenceIds ?? [])
      .map((id) => evidenceById.get(id))
      .filter((e): e is TraceEvidence => !!e);
    evidence.forEach((e, i) => {
      placedEvidence.add(e.id);
      const collected = ms(e.collectedAt);
      // Without a timestamp, spread evidence evenly across the task.
      const fallback =
        started != null && completed != null
          ? started + ((completed - started) * (i + 1)) / (evidence.length + 1)
          : (started ?? completed ?? origin);
      const at = collected ?? fallback;
      push({ ...base, kind: 'evidence', real: at, realAt: rel(at), node, agentType: task.agentType, label: e.summary, evidence: e, cue: 'evidence' });
    });
    const findings = (trace.findings ?? []).filter(
      (f) => f.id !== root?.id && (f.agentTaskId === task.id || (!f.agentTaskId && (task.findingIds ?? []).includes(f.id))),
    );
    for (const f of findings) {
      // A finding lands once its last evidence item from this task was collected.
      const times = (f.evidenceIds ?? [])
        .map((id) => evidenceById.get(id))
        .filter((e): e is TraceEvidence => !!e && e.agentTaskId === task.id)
        .map((e) => ms(e.collectedAt))
        .filter((t): t is number => t != null);
      const at = times.length ? Math.max(...times) : (completed ?? started ?? origin);
      push({
        ...base,
        kind: 'finding',
        real: at,
        realAt: rel(at),
        node,
        agentType: task.agentType,
        label: f.statement,
        detail: f.analyticsType,
        finding: f,
        cue: 'finding',
      });
    }
    if (completed != null) {
      push({
        ...base,
        kind: 'agentDone',
        real: completed,
        realAt: rel(completed),
        node,
        agentType: task.agentType,
        label: `${name} ${task.status.toLowerCase().replace(/_/g, ' ')}`,
        detail: task.error ?? formatMs(task.durationMs),
        status: task.status,
        cue: task.status === 'FAILED' ? 'error' : null,
      });
    }
  }

  raw.sort((a, b) => a.real - b.real || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.seq - b.seq);

  const beats: Beat[] = [];
  const chapters: Chapter[] = [];
  const steps = trace.steps ?? [];
  const autonomous = inv.triggerType === 'ANOMALY_DETECTED';
  beats.push({
    ...base,
    id: 'question',
    kind: 'question',
    at: 0,
    duration: BEAT_WEIGHT.question,
    realAt: 0,
    node: null,
    agentType: null,
    label: inv.question,
    detail: autonomous ? 'Opened by a monitor' : 'Asked by a person',
    cue: 'launch',
  });
  chapters.push({ at: 0, title: autonomous ? 'A monitor raises the question' : 'The question' });
  let clock = BEAT_WEIGHT.question;
  const specialists = steps.filter((s) => !isCoordinator(s.agentType)).length;
  beats.push({
    ...base,
    id: 'plan',
    kind: 'plan',
    at: clock,
    duration: BEAT_WEIGHT.plan,
    realAt: null,
    node: 'plan',
    agentType: 'COORDINATOR',
    label: steps.length ? `Planned ${plural(steps.length, 'step')}` : 'Planning',
    detail: specialists ? `${plural(specialists, 'specialist agent')} to brief` : null,
    cue: 'whoosh',
  });
  chapters.push({ at: clock, title: 'Coordinator makes a plan' });
  clock += BEAT_WEIGHT.plan;

  // Middle: real order, scaled weights.
  const rawTotal = raw.reduce((sum, b) => sum + BEAT_WEIGHT[b.kind], 0);
  const target = Math.min(MIDDLE_MAX_MS, Math.max(MIDDLE_MIN_MS, rawTotal));
  const scale = rawTotal > 0 ? target / rawTotal : 1;
  const waveOf = new Map(layout.nodes.map((n) => [n.key, n]));
  let lastWave = -2;
  for (const b of raw) {
    const n = b.node ? waveOf.get(b.node) : undefined;
    if (n && n.role === 'agent' && n.wave > lastWave && (b.kind === 'context' || b.kind === 'dispatch' || b.kind === 'agentStart')) {
      lastWave = n.wave;
      const names = layout.nodes.filter((x) => x.role === 'agent' && x.wave === n.wave).map((x) => x.label);
      chapters.push({
        at: clock,
        title: names.length > 1 ? `${joinNames(names)} dig in, in parallel` : `${names[0]} goes first`,
      });
    }
    beats.push({
      id: `${b.kind}-${b.seq}`,
      kind: b.kind,
      at: Math.round(clock),
      duration: Math.round(Math.max(b.visual * Math.max(scale, 0.6), 300)),
      realAt: b.realAt,
      node: b.node,
      agentType: b.agentType,
      label: b.label,
      detail: b.detail,
      transport: b.transport,
      status: b.status,
      finding: b.finding,
      evidence: b.evidence,
      context: b.context,
      cue: b.cue,
    });
    clock += BEAT_WEIGHT[b.kind] * scale;
  }
  clock = Math.round(clock);

  const complete = !isActiveStatus(inv.status);
  let synthAt: number | null = null;
  let revealAt: number | null = null;
  const confidence = root?.confidence ?? inv.overallConfidence ?? null;
  if (complete && root) {
    synthAt = clock + 400;
    beats.push({
      ...base,
      id: 'synthesize',
      kind: 'synthesize',
      at: synthAt,
      duration: BEAT_WEIGHT.synthesize,
      realAt: rel(ms(synthTask(trace)?.completedAt ?? null) ?? ms(inv.completedAt)),
      node: 'synth',
      agentType: 'COORDINATOR',
      label: 'Weighing the evidence',
      detail: `${plural(beats.filter((x) => x.kind === 'finding').length, 'finding')} considered`,
      cue: 'whoosh',
    });
    chapters.push({ at: synthAt, title: 'Coordinator weighs the evidence' });
    revealAt = synthAt + BEAT_WEIGHT.synthesize;
    beats.push({
      ...base,
      id: 'root-cause',
      kind: 'rootCause',
      at: revealAt,
      duration: BEAT_WEIGHT.rootCause,
      realAt: rel(ms(inv.completedAt)),
      node: 'synth',
      agentType: root.agentType,
      label: root.statement,
      finding: root,
      cue: 'rootCause',
    });
    chapters.push({ at: revealAt, title: 'Root cause' });
    clock = revealAt + BEAT_WEIGHT.rootCause;
  }

  const end = ms(inv.completedAt);
  return {
    beats,
    chapters,
    layout,
    total: clock,
    synthAt,
    revealAt,
    realTotal: end != null ? Math.max(0, end - origin) : null,
    complete,
    rootCause: root,
    confidence,
    tiles: rootCauseTiles(trace),
    culprit: root ? readCulprit(trace) : null,
    evidenceTotal: (trace.evidence ?? []).length,
    findingTotal: beats.filter((b) => b.kind === 'finding').length,
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// -------------------------------------------------------------- stage state

export type NodeStatus = 'idle' | 'briefed' | 'running' | 'done' | 'failed';

export interface StageState {
  phase: 'intro' | 'plan' | 'agents' | 'synth' | 'reveal';
  nodes: Record<string, NodeStatus>;
  /** Packets in flight with their progress (0..1). */
  packets: { beat: Beat; progress: number }[];
  /** Context chips currently shown, by node. */
  contexts: Record<string, Beat>;
  findings: Beat[];
  evidenceCount: number;
  /** The newest beat that has happened. */
  current: Beat | null;
  chapter: Chapter | null;
  chapterIndex: number;
  /** Real run time reached, in ms. */
  realMs: number;
}

/** Everything the stage shows at theater time `t`. */
export function stageAt(timeline: Timeline, t: number): StageState {
  const nodes: Record<string, NodeStatus> = {};
  for (const n of timeline.layout.nodes) nodes[n.key] = 'idle';
  const packets: StageState['packets'] = [];
  const contexts: Record<string, Beat> = {};
  const findings: Beat[] = [];
  let evidenceCount = 0;
  let current: Beat | null = null;
  let realMs = 0;
  for (const b of timeline.beats) {
    if (b.at > t) break;
    current = b;
    if (b.realAt != null) realMs = Math.max(realMs, b.realAt);
    const key = b.node;
    switch (b.kind) {
      case 'plan':
        nodes.plan = t < b.at + b.duration ? 'running' : 'done';
        break;
      case 'context':
        if (key && nodes[key] === 'idle') nodes[key] = 'briefed';
        if (key && t < b.at + b.duration) contexts[key] = b;
        break;
      case 'dispatch':
      case 'result':
        if (t < b.at + b.duration) packets.push({ beat: b, progress: (t - b.at) / b.duration });
        if (b.kind === 'dispatch' && key && nodes[key] === 'idle') nodes[key] = 'briefed';
        break;
      case 'agentStart':
        if (key) nodes[key] = 'running';
        break;
      case 'evidence':
        evidenceCount += 1;
        break;
      case 'finding':
        findings.push(b);
        break;
      case 'agentDone':
        if (key) nodes[key] = b.status === 'FAILED' ? 'failed' : 'done';
        break;
      case 'synthesize':
        nodes.synth = 'running';
        break;
      case 'rootCause':
        nodes.synth = 'done';
        break;
    }
  }
  // The Coordinator task can finish (agentDone) before the theatrical synthesis beat.
  if (timeline.synthAt != null && t >= timeline.synthAt && (timeline.revealAt == null || t < timeline.revealAt)) {
    nodes.synth = 'running';
  }
  let chapterIndex = -1;
  timeline.chapters.forEach((c, i) => {
    if (c.at <= t) chapterIndex = i;
  });
  const phase: StageState['phase'] =
    timeline.revealAt != null && t >= timeline.revealAt
      ? 'reveal'
      : timeline.synthAt != null && t >= timeline.synthAt
        ? 'synth'
        : current?.kind === 'plan'
          ? 'plan'
          : current == null || current.kind === 'question'
            ? 'intro'
            : 'agents';
  return {
    phase,
    nodes,
    packets,
    contexts,
    findings,
    evidenceCount,
    current,
    chapter: timeline.chapters[chapterIndex] ?? null,
    chapterIndex,
    realMs: Math.min(realMs, timeline.realTotal ?? realMs),
  };
}

/** Beats whose start falls in (from, to], for firing sound cues as the clock moves. */
export function beatsBetween(timeline: Timeline, from: number, to: number): Beat[] {
  if (to <= from) return [];
  return timeline.beats.filter((b) => b.at > from && b.at <= to);
}

/** Stereo pan (-1..1) for a stage node, so cues come from where the action is. */
export function nodePan(layout: StageLayout, key: string | null): number {
  const n = key ? layout.nodes.find((x) => x.key === key) : undefined;
  if (!n) return 0;
  return Math.max(-0.8, Math.min(0.8, ((n.x / STAGE_W) * 2 - 1) * 0.8));
}

// ------------------------------------------------------- root cause tiles

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((cur, k) => (isRecord(cur) ? cur[k] : undefined), obj);

function evidenceOfKind(list: TraceEvidence[], kind: string): TraceEvidence | null {
  return list.find((e) => pick(e.data, 'kind') === kind) ?? null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The four "What / When / Where / Why" tiles of the reveal, read from the
 * root cause finding's evidence (anomaly, segment breakdown, event
 * alignment). A tile is left out when the evidence for it is missing; values
 * are the API's own formatted strings, never invented.
 */
export function rootCauseTiles(trace: InvestigationTrace): RootCauseTile[] {
  const root = rootCauseFinding(trace);
  if (!root) return [];
  const all = trace.evidence ?? [];
  const linked = new Set(root.evidenceIds ?? []);
  const own = all.filter((e) => linked.has(e.id));
  const find = (kind: string) => evidenceOfKind(own, kind) ?? evidenceOfKind(all, kind);
  const anomaly = find('anomaly');
  const segment = find('segment');
  const event =
    own
      .filter((e) => pick(e.data, 'kind') === 'event_alignment')
      .sort((a, b) => (num(pick(b.data, 'relevance')) ?? 0) - (num(pick(a.data, 'relevance')) ?? 0))[0] ??
    evidenceOfKind(all, 'event_alignment');
  const tiles: RootCauseTile[] = [];

  const metric = str(pick(anomaly?.data, 'metricName')) ?? str(pick(anomaly?.data, 'metricKey'));
  const totalPct = str(pick(segment?.data, 'formatted', 'total', 'deltaPercent'));
  if (totalPct) {
    const actual = str(pick(segment?.data, 'formatted', 'total', 'actual'));
    const expected = str(pick(segment?.data, 'formatted', 'total', 'expected'));
    tiles.push({
      key: 'what',
      label: 'What',
      value: `${metric ? `${capitalize(metric)} ` : ''}${totalPct}`,
      detail: actual && expected ? `${actual} against an expected ${expected}` : null,
    });
  } else if (anomaly) {
    const value = num(pick(anomaly.data, 'value'));
    const expected = num(pick(anomaly.data, 'expectedValue'));
    const fv = str(pick(anomaly.data, 'formatted', 'value'));
    const fe = str(pick(anomaly.data, 'formatted', 'expectedValue'));
    if (value != null && expected != null && expected !== 0) {
      const pct = ((value - expected) / Math.abs(expected)) * 100;
      tiles.push({
        key: 'what',
        label: 'What',
        value: `${metric ? `${capitalize(metric)} ` : ''}${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
        detail: fv && fe ? `${fv} against an expected ${fe}` : null,
      });
    }
  }

  const day = str(pick(anomaly?.data, 'formatted', 'day')) ?? str(pick(anomaly?.data, 'date')) ?? str(pick(segment?.data, 'formatted', 'day'));
  if (day) {
    const eventTime = str(pick(event?.data, 'formatted', 'time'));
    const sameDay = pick(event?.data, 'sameDay') === true;
    const severity = str(pick(anomaly?.data, 'severity'));
    tiles.push({
      key: 'when',
      label: 'When',
      value: day,
      detail: eventTime && sameDay ? `Starting around ${eventTime}` : severity ? `${capitalize(severity.toLowerCase())} anomaly` : null,
    });
  }

  const column = str(pick(segment?.data, 'topSlice', 'column'));
  const slice = str(pick(segment?.data, 'topSlice', 'value'));
  if (column && slice) {
    const pct = str(pick(segment?.data, 'formatted', 'topSlice', 'deltaPercent'));
    const share = str(pick(segment?.data, 'formatted', 'topSlice', 'shareOfDelta'));
    // Over 100% means this slice alone lost more than the whole shortfall
    // (others moved the other way); "115% of the gap" confuses audiences.
    const shareRaw = num(pick(segment?.data, 'topSlice', 'shareOfDelta'));
    const shareText =
      shareRaw != null && shareRaw > 1 ? 'more than the entire shortfall' : share ? `${share} of the gap` : null;
    tiles.push({
      key: 'where',
      label: 'Where',
      value: `${column} = ${slice}`,
      detail: [pct ? `${pct} on the day` : null, shareText].filter(Boolean).join(', ') || null,
    });
  }

  const service = str(pick(event?.data, 'event', 'labels', 'service'));
  const version = str(pick(event?.data, 'event', 'labels', 'version'));
  if (service || version) {
    const time = str(pick(event?.data, 'formatted', 'time'));
    const status = str(pick(event?.data, 'event', 'labels', 'status'));
    const table = str(pick(event?.data, 'eventsTable'));
    tiles.push({
      key: 'why',
      label: 'Why',
      value: [service, version].filter(Boolean).join(' '),
      detail:
        [
          table === 'deployments' || !table ? `Deployed${time ? ` at ${time}` : ''}` : `${capitalize(table)} event${time ? ` at ${time}` : ''}`,
          status === 'rolled_back' ? 'later rolled back' : null,
        ]
          .filter(Boolean)
          .join(', ') || null,
    });
  }
  return tiles;
}
