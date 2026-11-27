import type {
  InvestigationTrace,
  RunMeta,
  TraceContextSnapshot,
  TraceFinding,
  TraceGraphEdge,
  TraceGraphNode,
  TraceGraphNodeType,
  TraceMessage,
  TraceStep,
  TraceTask,
  TriggerContext,
} from './api';

/**
 * Pure helpers that turn `GET /investigations/:id/trace` into view models for
 * the Replay, Evidence graph and Trace tabs. No I/O, no React, so they are
 * unit tested directly (lib/trace.test.ts).
 */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asStringList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const time = (v: string | null | undefined): number => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** "PRODUCT" -> "Product". */
export function agentLabel(agentType: string): string {
  const lower = agentType.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** 840 -> "840ms", 12_300 -> "12.3s", 125_000 -> "2m 05s". */
export function formatMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

/** Planner label for the plan card, from `result.meta`. */
export function plannerLabel(meta: RunMeta | null | undefined): string {
  const planner = meta?.planner;
  if (!planner) return 'Coordinator plan';
  if (planner.startsWith('llm')) {
    const model = meta?.llmModel ?? (planner.includes(':') ? planner.split(':').slice(1).join(':') : null);
    return model ? `LLM planner (${model})` : 'LLM planner';
  }
  return 'Rules planner';
}

/**
 * Execution wave of each plan step (by order): steps without dependencies run
 * in wave 0, every other step one wave after its latest dependency. Unknown or
 * cyclic dependencies are ignored rather than looping.
 */
export function computeWaves(steps: Pick<TraceStep, 'order' | 'dependsOn'>[]): Map<number, number> {
  const byOrder = new Map(steps.map((s) => [s.order, s]));
  const waves = new Map<number, number>();
  const visit = (order: number, seen: Set<number>): number => {
    const known = waves.get(order);
    if (known != null) return known;
    const step = byOrder.get(order);
    if (!step || seen.has(order)) return 0;
    seen.add(order);
    const deps = (step.dependsOn ?? []).filter((d) => byOrder.has(d) && d !== order);
    const wave = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => visit(d, seen)));
    waves.set(order, wave);
    return wave;
  };
  for (const s of steps) visit(s.order, new Set());
  return waves;
}

/** Messages that belong to a task: by agentTaskId, or by correlationId (= run task id). */
export function messagesForTask(messages: TraceMessage[], taskId: string): TraceMessage[] {
  return messages
    .filter((m) => m.agentTaskId === taskId || m.correlationId === taskId)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

/** Transport recorded on a TASK_REQUEST / TASK_RESULT payload ("a2a-gateway", "in-process ..."). */
export function messageTransport(m: Pick<TraceMessage, 'payload'>): string | null {
  return asString(m.payload?.transport);
}

/** The task a finding came from: its own agentTaskId, else the task that lists it. */
export function findingTaskId(trace: Pick<InvestigationTrace, 'tasks'>, f: TraceFinding): string | null {
  if (f.agentTaskId) return f.agentTaskId;
  return trace.tasks.find((t) => (t.findingIds ?? []).includes(f.id))?.id ?? null;
}

export function rootCauseFinding(trace: Pick<InvestigationTrace, 'findings' | 'investigation'>): TraceFinding | null {
  const id = trace.investigation.rootCauseFindingId;
  return trace.findings.find((f) => id && f.id === id) ?? trace.findings.find((f) => f.isRootCause) ?? null;
}

/**
 * Findings that contributed to the root cause: every other finding that
 * shares at least one evidence item with it (the synthesized root cause links
 * all contributing evidence plus its ranking evidence).
 */
export function contributingFindings(
  trace: Pick<InvestigationTrace, 'findings'>,
  rootCauseId: string | null | undefined,
): TraceFinding[] {
  const root = trace.findings.find((f) => f.id === rootCauseId);
  if (!root) return [];
  const evidence = new Set(root.evidenceIds ?? []);
  return trace.findings.filter((f) => f.id !== root.id && (f.evidenceIds ?? []).some((id) => evidence.has(id)));
}

/** Recommendation id -> the findings that justify it. */
export function recommendationFindings(
  trace: Pick<InvestigationTrace, 'findings' | 'recommendations'>,
): Map<string, TraceFinding[]> {
  const byId = new Map(trace.findings.map((f) => [f.id, f]));
  return new Map(
    trace.recommendations.map((r) => [
      r.id,
      (r.findingIds ?? []).map((id) => byId.get(id)).filter((f): f is TraceFinding => !!f),
    ]),
  );
}

/** Display rows for an ANOMALY_DETECTED trigger context. */
export function triggerContextRows(ctx: TriggerContext | null | undefined): { label: string; value: string }[] {
  if (!isRecord(ctx)) return [];
  const rows: { label: string; value: string }[] = [];
  const metric = asString(ctx.metricName) ?? asString(ctx.metricKey);
  if (metric) rows.push({ label: 'Metric', value: metric });
  if (asString(ctx.date)) rows.push({ label: 'Day', value: String(ctx.date) });
  if (asString(ctx.direction)) rows.push({ label: 'Direction', value: String(ctx.direction) });
  if (asString(ctx.severity)) rows.push({ label: 'Severity', value: String(ctx.severity).toLowerCase() });
  const value = asNumber(ctx.value);
  const expected = asNumber(ctx.expectedValue);
  if (value != null) rows.push({ label: 'Observed', value: formatPlain(value) });
  if (expected != null) rows.push({ label: 'Expected', value: formatPlain(expected) });
  if (value != null && expected != null && expected !== 0) {
    const pct = ((value - expected) / Math.abs(expected)) * 100;
    rows.push({ label: 'Change', value: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` });
  }
  const z = asNumber(ctx.deviationScore);
  if (z != null) rows.push({ label: 'Deviation', value: z.toFixed(2) });
  if (asString(ctx.table)) rows.push({ label: 'Table', value: String(ctx.table) });
  return rows;
}

function formatPlain(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

// ------------------------------------------------------------------ replay

export type ReplayStepKind =
  | 'question'
  | 'plan'
  | 'dispatch'
  | 'result'
  | 'findings'
  | 'rootCause'
  | 'recommendations'
  | 'summary';

export interface ReplayMessage {
  id: string;
  type: string;
  from: string;
  to: string;
  transport: string | null;
  at: string;
  detail: string | null;
}

export interface ReplayItem {
  id: string;
  label: string;
  detail?: string | null;
  confidence?: number | null;
}

export interface ReplayStep {
  id: string;
  kind: ReplayStepKind;
  title: string;
  description: string | null;
  at: string | null;
  agentType?: string;
  status?: string;
  wave?: number;
  messages: ReplayMessage[];
  items: ReplayItem[];
}

function toReplayMessage(m: TraceMessage): ReplayMessage {
  const p = m.payload ?? {};
  let detail: string | null = null;
  if (typeof p.error === 'string') detail = p.error;
  else if (typeof p.findings === 'number') detail = `${p.findings} finding${p.findings === 1 ? '' : 's'}`;
  else if (typeof p.objective === 'string') detail = p.objective;
  if (typeof p.status === 'string') detail = detail ? `${p.status.toLowerCase()}, ${detail}` : p.status.toLowerCase();
  return {
    id: m.id,
    type: m.type,
    from: m.fromAgent,
    to: m.toAgent,
    transport: messageTransport(m),
    at: m.createdAt,
    detail,
  };
}

const findingItem = (f: TraceFinding): ReplayItem => ({
  id: f.id,
  label: f.statement,
  detail: `${agentLabel(f.agentType)} agent, ${f.analyticsType.toLowerCase()}`,
  confidence: f.confidence,
});

/**
 * Rebuilds the run as an ordered list of replay steps:
 * question or trigger, plan, then per execution wave a dispatch step (the
 * TASK_REQUEST messages and their transport) followed by one result step per
 * task in completion order (TASK_RESULT / ERROR plus the findings it
 * reported), then the root cause, recommendations and the final summary.
 */
export function buildReplaySteps(trace: InvestigationTrace): ReplayStep[] {
  const inv = trace.investigation;
  const out: ReplayStep[] = [];
  const steps = [...(trace.steps ?? [])].sort((a, b) => a.order - b.order);
  const tasks = trace.tasks ?? [];
  const messages = trace.messages ?? [];
  const findings = trace.findings ?? [];
  const root = rootCauseFinding(trace);
  const autonomous = inv.triggerType === 'ANOMALY_DETECTED';

  out.push({
    id: 'question',
    kind: 'question',
    title: autonomous
      ? `Anomaly detected${inv.monitor?.name ? ` by monitor "${inv.monitor.name}"` : ' by a monitor'}`
      : 'Question asked',
    description: inv.question,
    at: inv.createdAt,
    messages: [],
    items: triggerContextRows(inv.triggerContext).map((r) => ({ id: `trigger-${r.label}`, label: r.label, detail: r.value })),
  });

  const reasoning = trace.plan?.reasoning ?? null;
  if (steps.length > 0 || reasoning) {
    out.push({
      id: 'plan',
      kind: 'plan',
      title: plannerLabel(trace.meta),
      description: reasoning,
      at: inv.startedAt,
      messages: [],
      items: steps.map((s) => ({
        id: s.id,
        label: `Step ${s.order}: ${agentLabel(s.agentType)}`,
        detail: s.dependsOn?.length ? `${s.objective} (after ${s.dependsOn.join(', ')})` : s.objective,
      })),
    });
  }

  // Group tasks by the execution wave of their plan step.
  const waves = computeWaves(steps);
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const maxWave = Math.max(-1, ...waves.values());
  const taskWave = (t: TraceTask): number => {
    const step = t.stepId ? stepById.get(t.stepId) : undefined;
    return step ? (waves.get(step.order) ?? 0) : maxWave + 1;
  };
  const grouped = new Map<number, TraceTask[]>();
  for (const t of tasks) {
    const w = taskWave(t);
    grouped.set(w, [...(grouped.get(w) ?? []), t]);
  }

  const findingsByTask = new Map<string, TraceFinding[]>();
  const placed = new Set<string>();
  for (const f of findings) {
    const taskId = findingTaskId(trace, f);
    if (!taskId) continue;
    findingsByTask.set(taskId, [...(findingsByTask.get(taskId) ?? []), f]);
  }

  const stepRank = (t: TraceTask) => (t.stepId ? (stepById.get(t.stepId)?.order ?? Infinity) : Infinity);
  for (const wave of [...grouped.keys()].sort((a, b) => a - b)) {
    const waveTasks = [...grouped.get(wave)!].sort((a, b) => stepRank(a) - stepRank(b));
    const requests = waveTasks.flatMap((t) =>
      messagesForTask(messages, t.id).filter((m) => m.type === 'TASK_REQUEST'),
    );
    const dispatchedAt = [...requests.map((m) => m.createdAt), ...waveTasks.map((t) => t.startedAt)]
      .filter((v): v is string => !!v)
      .sort((a, b) => time(a) - time(b))[0];
    out.push({
      id: `wave-${wave}`,
      kind: 'dispatch',
      title: `Wave ${wave + 1}: ${waveTasks.map((t) => agentLabel(t.agentType)).join(', ')}`,
      description:
        waveTasks.length > 1 ? `${waveTasks.length} tasks dispatched concurrently.` : 'One task dispatched.',
      at: dispatchedAt ?? null,
      wave,
      messages: requests.sort((a, b) => time(a.createdAt) - time(b.createdAt)).map(toReplayMessage),
      items: waveTasks.map((t) => ({ id: t.id, label: agentLabel(t.agentType), detail: t.objective })),
    });

    const ordered = [...waveTasks].sort((a, b) => time(a.completedAt) - time(b.completedAt));
    for (const t of ordered) {
      const taskFindings = (findingsByTask.get(t.id) ?? []).filter((f) => f.id !== root?.id);
      taskFindings.forEach((f) => placed.add(f.id));
      const duration = formatMs(t.durationMs);
      const parts = [
        t.error ?? `${taskFindings.length} finding${taskFindings.length === 1 ? '' : 's'}`,
        duration ? `in ${duration}` : null,
      ].filter(Boolean);
      out.push({
        id: `task-${t.id}`,
        kind: 'result',
        title: `${agentLabel(t.agentType)} agent ${t.status.toLowerCase().replace(/_/g, ' ')}`,
        description: parts.join(' '),
        at: t.completedAt ?? t.startedAt,
        agentType: t.agentType,
        status: t.status,
        wave,
        messages: messagesForTask(messages, t.id)
          .filter((m) => m.type !== 'TASK_REQUEST')
          .map(toReplayMessage),
        items: taskFindings.map(findingItem),
      });
    }
  }

  const orphans = findings.filter((f) => f.id !== root?.id && !placed.has(f.id));
  if (orphans.length > 0) {
    out.push({
      id: 'findings',
      kind: 'findings',
      title: 'Other findings',
      description: 'Findings not linked to a single task.',
      at: null,
      messages: [],
      items: orphans.map(findingItem),
    });
  }

  if (root) {
    out.push({
      id: 'root-cause',
      kind: 'rootCause',
      title: root.agentType === 'COORDINATOR' ? 'Root cause (Coordinator synthesis)' : 'Root cause',
      description: root.statement,
      at: inv.completedAt,
      agentType: root.agentType,
      messages: [],
      items: contributingFindings(trace, root.id).map(findingItem),
    });
  }

  const recs = trace.recommendations ?? [];
  if (recs.length > 0) {
    out.push({
      id: 'recommendations',
      kind: 'recommendations',
      title: `${recs.length} recommendation${recs.length === 1 ? '' : 's'}`,
      description: null,
      at: inv.completedAt,
      messages: [],
      items: recs.map((r) => ({ id: r.id, label: r.title, detail: r.priority.toLowerCase() })),
    });
  }

  if (inv.summary || inv.completedAt) {
    out.push({
      id: 'summary',
      kind: 'summary',
      title: `Investigation ${inv.status.toLowerCase().replace(/_/g, ' ')}`,
      description: inv.summary,
      at: inv.completedAt,
      messages: [],
      items:
        inv.overallConfidence != null
          ? [{ id: 'confidence', label: 'Overall confidence', confidence: inv.overallConfidence }]
          : [],
    });
  }

  return out;
}

// ------------------------------------------------------------------- graph

export const GRAPH_NODE_TYPES: TraceGraphNodeType[] = [
  'question',
  'step',
  'task',
  'evidence',
  'finding',
  'rootCause',
  'recommendation',
];

export const GRAPH_TYPE_LABEL: Record<TraceGraphNodeType, string> = {
  question: 'Question',
  step: 'Plan step',
  task: 'Agent task',
  evidence: 'Evidence',
  finding: 'Finding',
  rootCause: 'Root cause',
  recommendation: 'Recommendation',
};

const SYMBOL_SIZE: Record<TraceGraphNodeType, number> = {
  question: 34,
  step: 20,
  task: 26,
  evidence: 16,
  finding: 22,
  rootCause: 40,
  recommendation: 22,
};

export interface GraphNodeDetail {
  title: string;
  subtitle: string;
  body: string | null;
  confidence: number | null;
  data: unknown;
}

export interface GraphNodeDatum {
  id: string;
  name: string;
  type: TraceGraphNodeType;
  category: number;
  symbolSize: number;
  x: number;
  y: number;
  detail: GraphNodeDetail;
}

export interface GraphLinkDatum {
  source: string;
  target: string;
  kind: TraceGraphEdge['kind'];
}

export interface GraphData {
  nodes: GraphNodeDatum[];
  links: GraphLinkDatum[];
  categories: { name: string }[];
}

/** Graph node ids may be bare entity ids or "<type>:<id>"; returns the entity id. */
export function entityId(nodeId: string): string {
  const i = nodeId.indexOf(':');
  return i >= 0 ? nodeId.slice(i + 1) : nodeId;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

/** Derives the graph from the trace lists when the API did not send one. */
export function deriveGraph(trace: InvestigationTrace): { nodes: TraceGraphNode[]; edges: TraceGraphEdge[] } {
  const nodes: TraceGraphNode[] = [{ id: 'question', type: 'question', label: trace.investigation.question }];
  const edges: TraceGraphEdge[] = [];
  const stepIds = new Map<string, string>();
  for (const s of trace.steps ?? []) {
    const id = `step:${s.id}`;
    stepIds.set(s.id, id);
    nodes.push({ id, type: 'step', label: `Step ${s.order}: ${agentLabel(s.agentType)}`, agentType: s.agentType });
    edges.push({ from: 'question', to: id, kind: 'plans' });
  }
  const taskIds = new Set<string>();
  for (const t of trace.tasks ?? []) {
    const id = `task:${t.id}`;
    taskIds.add(t.id);
    nodes.push({ id, type: 'task', label: `${agentLabel(t.agentType)} task`, agentType: t.agentType });
    const step = t.stepId ? stepIds.get(t.stepId) : undefined;
    edges.push({ from: step ?? 'question', to: id, kind: step ? 'runs' : 'plans' });
  }
  const evidenceIds = new Set<string>();
  for (const e of trace.evidence ?? []) {
    const id = `evidence:${e.id}`;
    evidenceIds.add(e.id);
    nodes.push({ id, type: 'evidence', label: e.summary, confidence: e.confidence });
    if (e.agentTaskId && taskIds.has(e.agentTaskId)) edges.push({ from: `task:${e.agentTaskId}`, to: id, kind: 'collected' });
  }
  const findingIds = new Set<string>();
  for (const f of trace.findings ?? []) {
    const id = `finding:${f.id}`;
    findingIds.add(f.id);
    nodes.push({
      id,
      type: f.isRootCause ? 'rootCause' : 'finding',
      label: f.statement,
      agentType: f.agentType,
      confidence: f.confidence,
    });
    for (const ev of f.evidenceIds ?? []) {
      if (evidenceIds.has(ev)) edges.push({ from: `evidence:${ev}`, to: id, kind: 'supports' });
    }
    if (f.isRootCause && f.agentTaskId && taskIds.has(f.agentTaskId)) {
      edges.push({ from: `task:${f.agentTaskId}`, to: id, kind: 'selected' });
    }
  }
  for (const r of trace.recommendations ?? []) {
    const id = `recommendation:${r.id}`;
    nodes.push({ id, type: 'recommendation', label: r.title });
    for (const fid of r.findingIds ?? []) {
      if (findingIds.has(fid)) edges.push({ from: `finding:${fid}`, to: id, kind: 'justifies' });
    }
  }
  return { nodes, edges };
}

/** Short text for an evidence `source` (a string, or an object such as `{ engine, endpoint }`). */
export function describeSource(source: unknown): string | null {
  if (typeof source === 'string') return source.trim() || null;
  if (isRecord(source)) {
    const parts = Object.values(source).filter((v) => typeof v === 'string' || typeof v === 'number');
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

/** Side panel content for one node, looked up in the trace lists. */
export function nodeDetail(trace: InvestigationTrace, node: TraceGraphNode): GraphNodeDetail {
  const id = entityId(node.id);
  const subtitle = [GRAPH_TYPE_LABEL[node.type] ?? node.type, node.agentType ? `${agentLabel(node.agentType)} agent` : null]
    .filter(Boolean)
    .join(', ');
  const base: GraphNodeDetail = { title: node.label, subtitle, body: null, confidence: node.confidence ?? null, data: null };
  const finding = trace.findings.find((f) => f.id === id || f.id === node.id);
  if ((node.type === 'finding' || node.type === 'rootCause') && finding) {
    return {
      ...base,
      title: finding.statement,
      body: `${finding.analyticsType.toLowerCase()} analysis${finding.isRootCause ? ', selected as root cause' : ''}`,
      confidence: finding.confidence,
      data: { evidenceIds: finding.evidenceIds },
    };
  }
  const evidence = trace.evidence.find((e) => e.id === id || e.id === node.id);
  if (node.type === 'evidence' && evidence) {
    return {
      ...base,
      title: evidence.summary,
      body: [evidence.sourceType.replace(/_/g, ' ').toLowerCase(), describeSource(evidence.source)].filter(Boolean).join(', '),
      confidence: evidence.confidence,
      data: evidence.data,
    };
  }
  const task = trace.tasks.find((t) => t.id === id || t.id === node.id);
  if (node.type === 'task' && task) {
    const duration = formatMs(task.durationMs);
    return {
      ...base,
      body: [task.objective, `Status ${task.status.toLowerCase()}${duration ? `, ${duration}` : ''}`, task.error]
        .filter(Boolean)
        .join('. '),
      data: { findingIds: task.findingIds, evidenceIds: task.evidenceIds },
    };
  }
  const step = trace.steps.find((s) => s.id === id || s.id === node.id);
  if (node.type === 'step' && step) return { ...base, body: step.objective, data: { dependsOn: step.dependsOn } };
  const rec = trace.recommendations.find((r) => r.id === id || r.id === node.id);
  if (node.type === 'recommendation' && rec) {
    return {
      ...base,
      title: rec.title,
      body: [rec.description, rec.expectedImpact ? `Expected impact: ${rec.expectedImpact}` : null, `Priority ${rec.priority.toLowerCase()}`]
        .filter(Boolean)
        .join(' '),
    };
  }
  if (node.type === 'question') {
    return { ...base, title: trace.investigation.question, body: trace.investigation.summary };
  }
  return base;
}

/**
 * ECharts-ready graph data. Uses the API's graph when present (otherwise
 * derives one), drops edges to unknown nodes, and lays nodes out in columns
 * by type (question, steps, tasks, evidence, findings, root cause,
 * recommendations) so the default view reads left to right.
 */
export function buildGraphData(trace: InvestigationTrace): GraphData {
  const source = trace.graph?.nodes?.length ? trace.graph : deriveGraph(trace);
  const seen = new Set<string>();
  const rawNodes = source.nodes.filter((n) => {
    if (seen.has(n.id) || !GRAPH_NODE_TYPES.includes(n.type)) return false;
    seen.add(n.id);
    return true;
  });
  const columns = new Map<TraceGraphNodeType, TraceGraphNode[]>();
  for (const n of rawNodes) columns.set(n.type, [...(columns.get(n.type) ?? []), n]);

  const nodes: GraphNodeDatum[] = [];
  GRAPH_NODE_TYPES.forEach((type, col) => {
    const list = columns.get(type) ?? [];
    list.forEach((n, i) => {
      nodes.push({
        id: n.id,
        name: truncate(n.label || GRAPH_TYPE_LABEL[type], 48),
        type,
        category: col,
        symbolSize: SYMBOL_SIZE[type],
        x: col * 220,
        y: (i - (list.length - 1) / 2) * 64,
        detail: nodeDetail(trace, n),
      });
    });
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links = (source.edges ?? [])
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
  return { nodes, links, categories: GRAPH_NODE_TYPES.map((t) => ({ name: GRAPH_TYPE_LABEL[t] })) };
}

// ------------------------------------------------------------- trace view

export interface SnapshotDecision {
  rule: string;
  kept: string[];
  dropped: string[];
  reason: string;
}

export interface SnapshotView {
  id: string;
  source: string | null;
  tokenCount: number | null;
  truncated: boolean;
  focus: { anomalyDates: string[]; metricKeys: string[]; direction: string | null };
  decisions: SnapshotDecision[];
  dataSources: { name: string; type: string; tables: string[] }[];
  upstream: { findings: number; evidence: number };
  history: { metrics: number; anomalies: number; findings: number };
  raw: unknown;
}

/** Parses an AssembledContext (free-form JSON over the wire) defensively. */
export function readSnapshot(snapshot: TraceContextSnapshot): SnapshotView {
  const ctx = isRecord(snapshot.assembledContext) ? snapshot.assembledContext : {};
  const focus = isRecord(ctx.focus) ? ctx.focus : {};
  const upstream = isRecord(ctx.upstream) ? ctx.upstream : {};
  const history = isRecord(ctx.history) ? ctx.history : {};
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    id: snapshot.id,
    source: asString(ctx.source),
    tokenCount: snapshot.tokenCount ?? asNumber(ctx.tokenCount),
    truncated: ctx.truncated === true,
    focus: {
      anomalyDates: asStringList(focus.anomalyDates),
      metricKeys: asStringList(focus.metricKeys),
      direction: asString(focus.direction),
    },
    decisions: (Array.isArray(ctx.decisions) ? ctx.decisions : []).filter(isRecord).map((d) => ({
      rule: asString(d.rule) ?? 'rule',
      kept: asStringList(d.kept),
      dropped: asStringList(d.dropped),
      reason: asString(d.reason) ?? '',
    })),
    dataSources: (Array.isArray(ctx.dataSources) ? ctx.dataSources : []).filter(isRecord).map((ds) => ({
      name: asString(ds.name) ?? 'unnamed',
      type: asString(ds.type) ?? '',
      tables: (Array.isArray(ds.schemas) ? ds.schemas : [])
        .filter(isRecord)
        .map((t) => asString(t.tableName) ?? asString(t.name) ?? '?'),
    })),
    upstream: { findings: len(upstream.findings), evidence: len(upstream.evidence) },
    history: {
      metrics: len(history.recentMetrics),
      anomalies: len(history.recentAnomalies),
      findings: len(history.pastFindings),
    },
    raw: snapshot.assembledContext,
  };
}

/** The context snapshot a task received: by id, else by agentTaskId (also inside the context). */
export function snapshotForTask(snapshots: TraceContextSnapshot[], task: TraceTask): TraceContextSnapshot | null {
  return (
    snapshots.find((s) => task.contextSnapshotId && s.id === task.contextSnapshotId) ??
    snapshots.find((s) => s.agentTaskId === task.id) ??
    snapshots.find((s) => isRecord(s.assembledContext) && s.assembledContext.agentTaskId === task.id) ??
    null
  );
}

// --------------------------------------------- result screen view models
// Read by the Overview story hero, evidence cards, replay lanes, the causal
// graph and the trace sequence diagram. All defensive: evidence `data` and
// task `result` are free-form JSON.

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  id: string;
  name: string;
  unit: string | null;
  series: SeriesPoint[];
}

/** Daily series every agent computed (`task.result.metrics[].series`), by metric id. */
export function metricSeriesById(trace: Pick<InvestigationTrace, 'tasks'>): Map<string, MetricSeries> {
  const out = new Map<string, MetricSeries>();
  for (const t of trace.tasks ?? []) {
    const r = isRecord(t.result) ? t.result : null;
    const metrics = r && Array.isArray(r.metrics) ? r.metrics : [];
    for (const m of metrics) {
      if (!isRecord(m)) continue;
      const id = asString(m.id);
      if (!id) continue;
      const series = (Array.isArray(m.series) ? m.series : [])
        .filter(isRecord)
        .map((p) => ({ date: (asString(p.timestamp) ?? asString(p.date) ?? '').slice(0, 10), value: asNumber(p.value) }))
        .filter((p): p is SeriesPoint => !!p.date && p.value != null)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (series.length > 0) out.set(id, { id, name: asString(m.name) ?? id, unit: asString(m.unit), series });
    }
  }
  return out;
}

/** `data.kind` of an evidence row ("anomaly", "segment", ...). */
export function evidenceKind(e: { data: unknown }): string | null {
  return isRecord(e.data) ? asString(e.data.kind) : null;
}

export interface AnomalyView {
  metricId: string | null;
  metricKey: string | null;
  metricName: string;
  unit: string | null;
  date: string;
  value: number;
  expected: number | null;
  changePercent: number | null;
  deviationScore: number | null;
  severity: string | null;
  direction: string | null;
}

export function readAnomaly(data: unknown): AnomalyView | null {
  if (!isRecord(data)) return null;
  const value = asNumber(data.value);
  const date = (asString(data.date) ?? asString(data.timestamp) ?? '').slice(0, 10);
  if (value == null || !date) return null;
  const expected = asNumber(data.expectedValue);
  return {
    metricId: asString(data.metricId),
    metricKey: asString(data.metricKey),
    metricName: asString(data.metricName) ?? asString(data.metricKey) ?? 'metric',
    unit: asString(data.unit),
    date,
    value,
    expected,
    changePercent: expected ? ((value - expected) / Math.abs(expected)) * 100 : null,
    deviationScore: asNumber(data.deviationScore),
    severity: asString(data.severity),
    direction: asString(data.direction),
  };
}

export interface SliceView {
  value: string;
  actual: number;
  expected: number;
  delta: number;
  deltaPercent: number | null;
  shareOfDelta: number | null;
}

export interface SegmentView {
  column: string;
  date: string | null;
  metricName: string;
  metricKey: string | null;
  unit: string | null;
  direction: string | null;
  total: { actual: number; expected: number; delta: number; deltaPercent: number | null } | null;
  slices: SliceView[];
  top: SliceView | null;
  maxGapPoints: number | null;
}

function readSlice(s: unknown): SliceView | null {
  if (!isRecord(s)) return null;
  const actual = asNumber(s.actual);
  const expected = asNumber(s.expected);
  if (actual == null || expected == null) return null;
  return {
    value: asString(s.value) ?? String(s.value ?? '?'),
    actual,
    expected,
    delta: asNumber(s.delta) ?? actual - expected,
    deltaPercent: asNumber(s.deltaPercent),
    shareOfDelta: asNumber(s.shareOfDelta),
  };
}

/** segment / segment_volume / segment_neutral evidence: the leading dimension and its slices. */
export function readSegment(data: unknown): SegmentView | null {
  if (!isRecord(data)) return null;
  const dims = (Array.isArray(data.dimensions) ? data.dimensions : []).filter(isRecord);
  const topRaw = isRecord(data.topSlice) ? data.topSlice : null;
  const topColumn = topRaw ? asString(topRaw.column) : null;
  const dim = dims.find((d) => topColumn && d.column === topColumn) ?? dims[0];
  if (!dim) return null;
  const slices = (Array.isArray(dim.slices) ? dim.slices : []).map(readSlice).filter((s): s is SliceView => !!s);
  const totalRaw = isRecord(data.total) ? data.total : null;
  const tActual = totalRaw ? asNumber(totalRaw.actual) : null;
  const tExpected = totalRaw ? asNumber(totalRaw.expected) : null;
  return {
    column: asString(dim.column) ?? 'segment',
    date: asString(data.date),
    metricName: asString(data.metricName) ?? asString(data.metricKey) ?? 'metric',
    metricKey: asString(data.metricKey),
    unit: asString(data.unit),
    direction: asString(data.direction),
    total:
      tActual != null && tExpected != null
        ? {
            actual: tActual,
            expected: tExpected,
            delta: asNumber(totalRaw!.delta) ?? tActual - tExpected,
            deltaPercent: asNumber(totalRaw!.deltaPercent),
          }
        : null,
    slices,
    top: topRaw ? readSlice(topRaw) : null,
    maxGapPoints: asNumber(data.maxGapPoints),
  };
}

export interface EventView {
  time: string;
  date: string | null;
  label: string;
  service: string | null;
  version: string | null;
  status: string | null;
  description: string | null;
  author: string | null;
  hoursBefore: number | null;
  sameDay: boolean;
  relevance: number | null;
  keywords: string[];
}

/** event_alignment evidence: the deploy (or other event) next to the anomaly day. */
export function readEvent(data: unknown): EventView | null {
  if (!isRecord(data) || !isRecord(data.event)) return null;
  const time = asString(data.event.time);
  if (!time) return null;
  const labels = isRecord(data.event.labels) ? data.event.labels : {};
  const service = asString(labels.service);
  const version = asString(labels.version);
  return {
    time,
    date: asString(data.date),
    label: [service, version].filter(Boolean).join(' ') || asString(labels.id) || 'event',
    service,
    version,
    status: asString(labels.status),
    description: asString(labels.description),
    author: asString(labels.author),
    hoursBefore: asNumber(data.hoursBefore),
    sameDay: data.sameDay === true,
    relevance: asNumber(data.relevance),
    keywords: asStringList(data.keywordMatch),
  };
}

export interface KpiView {
  metricName: string;
  unit: string | null;
  value: number;
  baseline: number | null;
  changePercent: number | null;
  pValue: number | null;
}

export function readKpi(data: unknown): KpiView | null {
  if (!isRecord(data)) return null;
  const value = asNumber(data.value);
  if (value == null) return null;
  return {
    metricName: asString(data.metricName) ?? asString(data.metricKey) ?? 'metric',
    unit: asString(data.unit),
    value,
    baseline: asNumber(data.baseline),
    changePercent: asNumber(data.changePercent),
    pValue: asNumber(data.pValue),
  };
}

export interface ForecastView {
  metricName: string;
  unit: string | null;
  method: string | null;
  mape: number | null;
  points: { date: string; value: number; lower: number | null; upper: number | null }[];
}

export function readForecast(data: unknown): ForecastView | null {
  if (!isRecord(data) || !Array.isArray(data.forecast)) return null;
  const points = data.forecast
    .filter(isRecord)
    .map((p) => ({
      date: (asString(p.timestamp) ?? '').slice(0, 10),
      value: asNumber(p.value),
      lower: asNumber(p.lower),
      upper: asNumber(p.upper),
    }))
    .filter((p): p is ForecastView['points'][number] => !!p.date && p.value != null);
  if (points.length === 0) return null;
  const backtest = isRecord(data.backtest) ? data.backtest : {};
  return {
    metricName: asString(data.metricName) ?? 'metric',
    unit: asString(data.unit),
    method: asString(data.methodUsed),
    mape: asNumber(backtest.mape),
    points,
  };
}

export interface CorrelationView {
  coefficient: number;
  method: string | null;
  metricName: string;
  otherMetric: string;
  pValue: number | null;
  lag: number | null;
  n: number | null;
}

export function readCorrelation(data: unknown): CorrelationView | null {
  if (!isRecord(data)) return null;
  const coefficient = asNumber(data.coefficient);
  if (coefficient == null) return null;
  return {
    coefficient,
    method: asString(data.method),
    metricName: asString(data.metricName) ?? asString(data.metricKey) ?? 'metric',
    otherMetric: asString(data.otherMetricKey) ?? 'other metric',
    pValue: asNumber(data.pValue),
    lag: asNumber(data.lag),
    n: asNumber(data.n),
  };
}

export interface RankingCandidate {
  id: string;
  score: number;
  statement: string;
  day: string | null;
  selected: boolean;
  components: { name: string; value: number }[];
  evidenceIds: string[];
}

export interface RankingView {
  method: string | null;
  threshold: number | null;
  candidates: RankingCandidate[];
}

export function readRanking(data: unknown): RankingView | null {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return null;
  const selectedId = asString(data.selectedCandidateId);
  const candidates = data.candidates
    .filter(isRecord)
    .map((c, i): RankingCandidate | null => {
      const score = asNumber(c.score);
      if (score == null) return null;
      const id = asString(c.id) ?? `candidate-${i}`;
      const formatted = isRecord(c.formatted) ? c.formatted : {};
      const comps = isRecord(c.components) ? c.components : {};
      return {
        id,
        score,
        statement: asString(c.statement) ?? id,
        day: asString(formatted.day),
        selected: selectedId ? id === selectedId : i === 0,
        components: Object.entries(comps)
          .map(([name, v]) => ({ name, value: asNumber(v) ?? 0 }))
          .sort((a, b) => b.value - a.value),
        evidenceIds: asStringList(c.contributingEvidenceIds),
      };
    })
    .filter((c): c is RankingCandidate => !!c)
    .sort((a, b) => b.score - a.score);
  return { method: asString(data.method), threshold: asNumber(data.threshold), candidates };
}

export type EvidenceVisual =
  | { kind: 'anomaly'; anomaly: AnomalyView }
  | { kind: 'segment'; segment: SegmentView; neutral: boolean }
  | { kind: 'kpi'; kpi: KpiView }
  | { kind: 'forecast'; forecast: ForecastView }
  | { kind: 'event'; event: EventView }
  | { kind: 'correlation'; correlation: CorrelationView }
  | { kind: 'ranking'; ranking: RankingView };

/** What a small chart for one evidence row should show, or null when there is nothing to plot. */
export function evidenceVisual(data: unknown): EvidenceVisual | null {
  const kind = isRecord(data) ? asString(data.kind) : null;
  switch (kind) {
    case 'anomaly':
    case 'co_anomaly': {
      const a = readAnomaly(data);
      return a ? { kind: 'anomaly', anomaly: a } : null;
    }
    case 'segment':
    case 'segment_volume':
    case 'segment_neutral': {
      const s = readSegment(data);
      return s && s.slices.length > 0 ? { kind: 'segment', segment: s, neutral: kind === 'segment_neutral' } : null;
    }
    case 'kpi': {
      const k = readKpi(data);
      return k ? { kind: 'kpi', kpi: k } : null;
    }
    case 'forecast': {
      const f = readForecast(data);
      return f ? { kind: 'forecast', forecast: f } : null;
    }
    case 'event_alignment': {
      const e = readEvent(data);
      return e ? { kind: 'event', event: e } : null;
    }
    case 'correlation': {
      const c = readCorrelation(data);
      return c ? { kind: 'correlation', correlation: c } : null;
    }
    case 'root_cause_ranking': {
      const r = readRanking(data);
      return r && r.candidates.length > 0 ? { kind: 'ranking', ranking: r } : null;
    }
    default:
      return null;
  }
}

/** True for evidence that shows something broke (critical anomaly or a segment drop). */
export function isAlarmEvidence(data: unknown): boolean {
  if (!isRecord(data)) return false;
  const kind = asString(data.kind);
  if (kind === 'anomaly' || kind === 'co_anomaly') return asString(data.severity) === 'CRITICAL';
  if (kind === 'segment' || kind === 'segment_volume') return asString(data.direction) === 'drop' && isRecord(data.topSlice);
  return false;
}

export interface RootCauseStory {
  findingId: string;
  statement: string;
  headline: string;
  confidence: number | null;
  agentType: string;
  what: (AnomalyView & { series: SeriesPoint[]; otherAnomalies: AnomalyView[] }) | null;
  where: SegmentView | null;
  volume: SegmentView | null;
  why: EventView | null;
  otherEvents: EventView[];
  ruledOut: SegmentView[];
  signals: AnomalyView[];
  ranking: RankingView | null;
}

const WEEKDAY_DAY = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

const humanMetric = (s: string) => s.replace(/\s*\(daily\)\s*$/i, '').replace(/_/g, ' ');

/**
 * The root cause as a story: what dropped (the anomaly and its daily series),
 * where (the segment that carries the drop), why (the aligned deploy), what
 * was ruled out and which other signals moved with it. Only uses the evidence
 * linked to the root cause (or its selected ranking candidate); null when
 * there is no root cause.
 */
export function buildRootCauseStory(trace: InvestigationTrace): RootCauseStory | null {
  const root = rootCauseFinding(trace);
  if (!root) return null;
  const all = trace.evidence ?? [];
  const rankingEv = all.find((e) => (root.evidenceIds ?? []).includes(e.id) && evidenceKind(e) === 'root_cause_ranking')
    ?? all.find((e) => evidenceKind(e) === 'root_cause_ranking');
  const ranking = rankingEv ? readRanking(rankingEv.data) : null;
  const selected = ranking?.candidates.find((c) => c.selected) ?? null;
  const poolIds = new Set([...(root.evidenceIds ?? []), ...(selected?.evidenceIds ?? [])]);
  const pool = all.filter((e) => poolIds.has(e.id));
  const of = (kinds: string[]) => pool.filter((e) => kinds.includes(evidenceKind(e) ?? ''));

  const trig = trace.investigation.triggerContext;
  const anomalies = of(['anomaly']).map((e) => readAnomaly(e.data)).filter((a): a is AnomalyView => !!a);
  const main =
    anomalies.find((a) => trig?.date && a.date === trig.date && (!trig.metricKey || a.metricKey === trig.metricKey)) ??
    [...anomalies].sort((a, b) => Math.abs(b.deviationScore ?? 0) - Math.abs(a.deviationScore ?? 0))[0] ??
    null;
  const seriesMap = metricSeriesById(trace);
  let what = main
    ? {
        ...main,
        series: (main.metricId ? seriesMap.get(main.metricId)?.series : undefined) ?? [],
        otherAnomalies: all
          .filter((e) => evidenceKind(e) === 'anomaly')
          .map((e) => readAnomaly(e.data))
          .filter((a): a is AnomalyView => !!a && a.metricId === main.metricId && a.date !== main.date),
      }
    : null;

  const where = of(['segment']).map((e) => readSegment(e.data)).find((s) => s?.top) ?? null;
  // The root cause statement quotes the segment comparison's total (same
  // weekday baseline), while the anomaly detector has its own expected value.
  // Use the statement's numbers so the headline never contradicts the text.
  if (what && where?.total && where.date?.slice(0, 10) === what.date) {
    const t = where.total;
    what = {
      ...what,
      value: t.actual,
      expected: t.expected,
      changePercent: t.deltaPercent ?? (t.expected ? ((t.actual - t.expected) / Math.abs(t.expected)) * 100 : what.changePercent),
    };
  }
  const volume = of(['segment_volume']).map((e) => readSegment(e.data)).find((s) => s?.top) ?? null;
  const events = of(['event_alignment'])
    .map((e) => readEvent(e.data))
    .filter((e): e is EventView => !!e)
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  const why = events[0] ?? null;
  const otherEvents = all
    .filter((e) => evidenceKind(e) === 'event_alignment')
    .map((e) => readEvent(e.data))
    .filter((e): e is EventView => !!e && !(why && e.time === why.time && e.label === why.label));
  const ruledOut = all
    .filter((e) => evidenceKind(e) === 'segment_neutral')
    .map((e) => readSegment(e.data))
    .filter((s): s is SegmentView => !!s);
  const signals = of(['co_anomaly']).map((e) => readAnomaly(e.data)).filter((a): a is AnomalyView => !!a);

  let headline = root.statement;
  if (what) {
    const pct = what.changePercent != null ? ` ${Math.abs(what.changePercent).toFixed(1)}%` : '';
    const verb = what.direction === 'spike' || (what.changePercent ?? 0) > 0 ? 'jumped' : 'fell';
    const name = humanMetric(what.metricName);
    headline = `${name.charAt(0).toUpperCase()}${name.slice(1)} ${verb}${pct} on ${WEEKDAY_DAY(what.date)}`;
    const top = where?.top ?? volume?.top;
    const col = where?.column ?? volume?.column;
    if (top && col) headline += ` because the ${top.value} ${col} ${(top.deltaPercent ?? top.delta) < 0 ? 'collapsed' : 'surged'}`;
    if (why) headline += `${top ? ',' : ''} right after the ${why.label} ${why.service || why.version ? 'deploy' : 'event'}`;
    headline += '.';
  }

  return {
    findingId: root.id,
    statement: root.statement,
    headline,
    confidence: root.confidence ?? trace.investigation.overallConfidence ?? null,
    agentType: root.agentType,
    what,
    where,
    volume,
    why,
    otherEvents,
    ruledOut,
    signals,
    ranking,
  };
}

// ------------------------------------------------------- replay swimlanes

export const AGENT_LANES = ['COORDINATOR', 'ANALYTICS', 'FINANCE', 'CUSTOMER', 'PRODUCT'] as const;

export type ReplayMarkerTone = 'info' | 'start' | 'done' | 'fail' | 'root';

export interface ReplayMarker {
  step: number;
  lane: string;
  tone: ReplayMarkerTone;
  count: number;
}

/** Places each replay step on an agent lane (dispatch steps also mark every agent they start). */
export function replayLanes(steps: ReplayStep[]): { lanes: string[]; markers: ReplayMarker[] } {
  const markers: ReplayMarker[] = [];
  steps.forEach((s, i) => {
    if (s.kind === 'dispatch') {
      markers.push({ step: i, lane: 'COORDINATOR', tone: 'info', count: 0 });
      const targets = new Set(s.messages.map((m) => m.to.toUpperCase()));
      for (const t of targets) if (t !== 'COORDINATOR') markers.push({ step: i, lane: t, tone: 'start', count: 0 });
    } else if (s.kind === 'result') {
      const lane = (s.agentType ?? 'COORDINATOR').toUpperCase();
      const failed = /FAIL|ERROR|CANCEL/.test(s.status ?? '');
      markers.push({ step: i, lane, tone: failed ? 'fail' : 'done', count: s.items.length });
    } else if (s.kind === 'rootCause') {
      markers.push({ step: i, lane: 'COORDINATOR', tone: 'root', count: 0 });
    } else {
      markers.push({ step: i, lane: 'COORDINATOR', tone: 'info', count: s.kind === 'findings' ? s.items.length : 0 });
    }
  });
  const lanes: string[] = [...AGENT_LANES];
  for (const m of markers) if (!lanes.includes(m.lane)) lanes.push(m.lane);
  return { lanes, markers };
}

// ------------------------------------------------- A2A sequence diagram

export interface SequenceArrow extends ReplayMessage {
  taskId: string | null;
  offsetMs: number;
}

/** A2A messages in time order with their offset from the first one, plus the lanes they touch. */
export function buildSequence(trace: Pick<InvestigationTrace, 'messages'>): {
  lanes: string[];
  arrows: SequenceArrow[];
  spanMs: number;
} {
  const sorted = [...(trace.messages ?? [])].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const t0 = sorted.length ? time(sorted[0]!.createdAt) : 0;
  const arrows = sorted.map((m) => ({
    ...toReplayMessage(m),
    from: m.fromAgent.toUpperCase(),
    to: m.toAgent.toUpperCase(),
    taskId: m.agentTaskId ?? m.correlationId,
    offsetMs: Number.isFinite(time(m.createdAt)) ? Math.max(0, time(m.createdAt) - t0) : 0,
  }));
  const touched = new Set(arrows.flatMap((a) => [a.from, a.to]));
  const lanes = [...AGENT_LANES.filter((l) => touched.has(l)), ...[...touched].filter((l) => !(AGENT_LANES as readonly string[]).includes(l))];
  return { lanes, arrows, spanMs: arrows.length ? arrows[arrows.length - 1]!.offsetMs : 0 };
}

// --------------------------------------------------------- token budget

export interface SnapshotBudget {
  budget: number | null;
  used: number | null;
  before: number | null;
  dropped: string[];
}

/** Token budget, tokens used and what was trimmed, read from the context engine's "budget" decision. */
export function snapshotBudget(view: Pick<SnapshotView, 'decisions' | 'tokenCount'>): SnapshotBudget {
  const d = view.decisions.find((x) => x.rule === 'budget');
  const num = (re: RegExp) => {
    const m = d?.reason.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    budget: num(/(\d+) token budget/),
    used: view.tokenCount,
    before: d && /exceeded/.test(d.reason) ? num(/About (\d+) tokens/) : null,
    dropped: d?.dropped ?? [],
  };
}

// ------------------------------------------------------ causal graph

export interface CausalNode {
  id: string;
  type: TraceGraphNodeType;
  column: number;
  row: number;
  x: number;
  y: number;
  label: string;
  agent: string | null;
  alarm: boolean;
  order: number;
  datum: GraphNodeDatum;
}

export interface CausalEdge {
  id: string;
  source: string;
  target: string;
  kind: TraceGraphEdge['kind'];
  toRoot: boolean;
}

export interface CausalLayout {
  nodes: CausalNode[];
  edges: CausalEdge[];
  columns: { label: string; x: number }[];
  width: number;
  height: number;
  rootId: string | null;
}

export const CAUSAL_COLUMNS = ['Question', 'Agents', 'Evidence', 'Findings', 'Root cause', 'Actions'] as const;
const CAUSAL_COLUMN: Record<TraceGraphNodeType, number> = {
  question: 0,
  step: 1,
  task: 1,
  evidence: 2,
  finding: 3,
  rootCause: 4,
  recommendation: 5,
};

/** "Agent task, Analytics agent" -> "Analytics". */
export function nodeAgent(n: Pick<GraphNodeDatum, 'detail'>): string | null {
  const m = n.detail.subtitle.match(/,\s*([^,]+?) agent$/);
  return m ? m[1]! : null;
}

/**
 * Lays the evidence graph out as a left-to-right causal flow: question,
 * agents (plan steps folded into the task they ran), evidence, findings, root
 * cause, actions. Rows are ordered to follow their parents so edges cross
 * less; `order` is the reveal order; `toRoot` marks edges on a path into the
 * root cause.
 */
export function layoutCausalGraph(data: GraphData, opts: { width?: number; rowGap?: number } = {}): CausalLayout {
  const width = opts.width ?? 1200;
  const rowGap = opts.rowGap ?? 34;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  // Fold steps into the task(s) they ran.
  const stepToTasks = new Map<string, string[]>();
  for (const l of data.links) {
    if (l.kind === 'runs' && byId.get(l.source)?.type === 'step' && byId.get(l.target)?.type === 'task') {
      stepToTasks.set(l.source, [...(stepToTasks.get(l.source) ?? []), l.target]);
    }
  }
  const kept = data.nodes.filter((n) => !(n.type === 'step' && stepToTasks.has(n.id)));
  const keptIds = new Set(kept.map((n) => n.id));
  const edgeMap = new Map<string, CausalEdge>();
  for (const l of data.links) {
    if (l.kind === 'runs' && stepToTasks.has(l.source)) continue;
    const sources = stepToTasks.get(l.source) ?? [l.source];
    const targets = stepToTasks.get(l.target) ?? [l.target];
    for (const s of sources)
      for (const t of targets) {
        if (s === t || !keptIds.has(s) || !keptIds.has(t)) continue;
        const id = `${s}->${t}`;
        if (!edgeMap.has(id)) edgeMap.set(id, { id, source: s, target: t, kind: l.kind, toRoot: false });
      }
  }
  const edges = [...edgeMap.values()];
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);

  const cols: GraphNodeDatum[][] = CAUSAL_COLUMNS.map(() => []);
  for (const n of kept) cols[CAUSAL_COLUMN[n.type]]!.push(n);
  const rowOf = new Map<string, number>();
  cols.forEach((list, c) => {
    const original = new Map(list.map((n, i) => [n.id, i]));
    if (c >= 2) {
      const score = (n: GraphNodeDatum) => {
        const ps = (parents.get(n.id) ?? []).map((p) => rowOf.get(p)).filter((r): r is number => r != null);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.POSITIVE_INFINITY;
      };
      list.sort((a, b) => score(a) - score(b) || original.get(a.id)! - original.get(b.id)!);
    }
    list.forEach((n, i) => rowOf.set(n.id, list.length > 1 ? i / (list.length - 1) : 0.5));
  });

  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const pad = 40;
  const height = Math.max(360, maxRows * rowGap + pad * 2);
  const colX = (c: number) => 70 + (c * (width - 140)) / (CAUSAL_COLUMNS.length - 1);

  const alarmIds = new Set<string>();
  for (const n of kept) if (n.type === 'evidence' && isAlarmEvidence(n.detail.data)) alarmIds.add(n.id);
  for (const n of kept) {
    if (n.type !== 'finding') continue;
    const ps = (parents.get(n.id) ?? []).filter((p) => byId.get(p)?.type === 'evidence');
    if (ps.length > 0 && ps.every((p) => alarmIds.has(p))) alarmIds.add(n.id);
  }

  let order = 0;
  const nodes: CausalNode[] = [];
  cols.forEach((list, c) => {
    const span = height - pad * 2;
    list.forEach((n, i) => {
      nodes.push({
        id: n.id,
        type: n.type,
        column: c,
        row: i,
        x: colX(c),
        y: list.length === 1 ? height / 2 : pad + (i + 0.5) * (span / list.length),
        label: n.name,
        agent: nodeAgent(n),
        alarm: alarmIds.has(n.id),
        order: order++,
        datum: n,
      });
    });
  });

  const rootId = nodes.find((n) => n.type === 'rootCause')?.id ?? null;
  if (rootId) {
    const anc = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of parents.get(cur) ?? []) {
        if (anc.has(p)) continue;
        anc.add(p);
        queue.push(p);
      }
    }
    for (const e of edges) e.toRoot = anc.has(e.source) && anc.has(e.target);
  }
  return {
    nodes,
    edges,
    columns: CAUSAL_COLUMNS.map((label, c) => ({ label, x: colX(c) })),
    width,
    height,
    rootId,
  };
}

/** Every node upstream and downstream of `id` (inclusive), for hover highlighting. */
export function causalChain(edges: Pick<CausalEdge, 'source' | 'target'>[], id: string): Set<string> {
  const out = new Set([id]);
  const walk = (dir: 'up' | 'down') => {
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        const next = dir === 'up' ? (e.target === cur ? e.source : null) : e.source === cur ? e.target : null;
        if (next && !out.has(next)) {
          out.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk('up');
  walk('down');
  return out;
}

// ------------------------------------------------------------ culprit

export type FixStepKind = 'rollback' | 'verify' | 'review' | 'test' | 'prevent';
export const FIX_STEP_KINDS: FixStepKind[] = ['rollback', 'verify', 'review', 'test', 'prevent'];

export interface FixStep {
  kind: FixStepKind;
  title: string;
  detail: string | null;
}

export interface FixPlan {
  state: 'rolled_back' | 'needs_rollback' | 'failed' | string;
  recovered: boolean | null;
  recoveredThrough: string | null;
  steps: FixStep[];
}

export interface CulpritDeploy {
  version: string | null;
  author: string | null;
  deployedAt: string | null;
  status: string | null;
  description: string | null;
  commitSha: string | null;
}

export interface Culprit {
  id: string | null;
  author: string | null;
  service: string | null;
  version: string | null;
  environment: string | null;
  status: string | null;
  description: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  deployedAt: string | null;
  history: { previous: CulpritDeploy | null; rollback: CulpritDeploy | null };
  fixPlan: FixPlan | null;
  /** 'ranking' = the Coordinator's culprit and fix plan; 'fallback' = derived from the deploy labels. */
  source: 'ranking' | 'fallback';
}

const firstString = (r: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = asString(r[k]);
    if (v) return v;
  }
  return null;
};
const httpUrl = (v: string | null): string | null => (v && /^https?:\/\//i.test(v) ? v : null);

function readDeploy(v: unknown): CulpritDeploy | null {
  if (!isRecord(v)) return null;
  const d: CulpritDeploy = {
    version: asString(v.version),
    author: asString(v.author),
    deployedAt: firstString(v, 'deployedAt', 'deployed_at', 'time'),
    status: asString(v.status),
    description: asString(v.description),
    commitSha: firstString(v, 'commitSha', 'commit_sha'),
  };
  return d.version || d.author || d.deployedAt ? d : null;
}

function readFixPlan(v: unknown): FixPlan | null {
  if (!isRecord(v) || !Array.isArray(v.steps)) return null;
  const steps = v.steps
    .filter(isRecord)
    .map((s): FixStep | null => {
      const title = asString(s.title);
      if (!title) return null;
      const kind = asString(s.kind);
      return {
        kind: FIX_STEP_KINDS.includes(kind as FixStepKind) ? (kind as FixStepKind) : 'review',
        title,
        detail: asString(s.detail),
      };
    })
    .filter((s): s is FixStep => !!s);
  if (steps.length === 0) return null;
  return {
    state: asString(v.state) ?? 'unknown',
    recovered: typeof v.recovered === 'boolean' ? v.recovered : null,
    recoveredThrough: asString(v.recoveredThrough),
    steps,
  };
}

/** A repo URL label plus a sha makes a commit link; never guessed otherwise. */
function commitLink(labels: Record<string, unknown>, sha: string | null): string | null {
  const direct = httpUrl(firstString(labels, 'commitUrl', 'commit_url'));
  if (direct) return direct;
  const repo = httpUrl(firstString(labels, 'repoUrl', 'repo_url', 'repository_url', 'repository'));
  return repo && sha ? `${repo.replace(/\/+$/, '')}/commit/${sha}` : null;
}

const BAD_STATUS = /fail|roll|revert|error|abort/i;

/**
 * Who shipped the change behind the root cause, and how to fix it. Reads the
 * Coordinator's `culprit` and `fixPlan` on the root_cause_ranking evidence;
 * older investigations fall back to the labels of the root cause's strongest
 * event_alignment deploy (no fix plan, history only from deploys in the
 * trace). Null when the root cause is not tied to a deploy.
 */
export function readCulprit(trace: InvestigationTrace): Culprit | null {
  const root = rootCauseFinding(trace);
  if (!root) return null;
  const all = trace.evidence ?? [];
  const linked = new Set(root.evidenceIds ?? []);
  const rankings = all.filter((e) => evidenceKind(e) === 'root_cause_ranking');
  const rankingEv = rankings.find((e) => linked.has(e.id)) ?? rankings[0] ?? null;
  const rankingData = rankingEv && isRecord(rankingEv.data) ? rankingEv.data : null;

  if (rankingData && isRecord(rankingData.culprit)) {
    const c = rankingData.culprit;
    const history = isRecord(c.history) ? c.history : {};
    const author = asString(c.author);
    const service = asString(c.service);
    if (author || service) {
      const commitSha = firstString(c, 'commitSha', 'commit_sha');
      return {
        id: asString(c.id),
        author,
        service,
        version: asString(c.version),
        environment: asString(c.environment),
        status: asString(c.status),
        description: asString(c.description),
        commitSha,
        commitUrl: httpUrl(firstString(c, 'commitUrl', 'commit_url')) ?? commitLink(c, commitSha),
        deployedAt: firstString(c, 'deployedAt', 'deployed_at'),
        history: { previous: readDeploy(history.previous), rollback: readDeploy(history.rollback) },
        fixPlan: readFixPlan(rankingData.fixPlan),
        source: 'ranking',
      };
    }
  }

  // Fallback: the root cause's (or its selected candidate's) strongest deploy.
  const ranking = rankingData ? readRanking(rankingData) : null;
  const selected = ranking?.candidates.find((c) => c.selected) ?? null;
  const pool = new Set([...linked, ...(selected?.evidenceIds ?? [])]);
  const deploys = all
    .filter((e) => evidenceKind(e) === 'event_alignment' && isRecord(e.data) && isRecord(e.data.event))
    .map((e) => {
      const data = e.data as Record<string, unknown>;
      const event = data.event as Record<string, unknown>;
      return {
        own: pool.has(e.id),
        revert: data.revert === true,
        relevance: asNumber(data.relevance) ?? 0,
        time: asString(event.time),
        labels: isRecord(event.labels) ? event.labels : {},
      };
    });
  const main = deploys
    .filter((d) => d.own && !d.revert)
    .sort((a, b) => b.relevance - a.relevance)[0];
  if (!main) return null;
  const l = main.labels;
  const author = asString(l.author);
  const service = asString(l.service);
  if (!author && !service) return null;
  const commitSha = firstString(l, 'commit_sha', 'commitSha', 'commit');
  const status = asString(l.status);
  const at = time(main.time);
  const sameService = deploys
    .filter((d) => d !== main && service && asString(d.labels.service) === service)
    .map((d) => ({
      at: time(d.time),
      deploy: readDeploy({ ...d.labels, deployedAt: d.time }),
      revert: d.revert,
      status: asString(d.labels.status),
    }))
    .filter((d) => d.deploy && Number.isFinite(d.at));
  const previous =
    sameService.filter((d) => d.at < at && !BAD_STATUS.test(d.status ?? '')).sort((a, b) => b.at - a.at)[0]?.deploy ?? null;
  const later = sameService.filter((d) => d.at > at).sort((a, b) => a.at - b.at);
  const rollback = (later.find((d) => d.revert) ?? (status === 'rolled_back' ? later[0] : undefined))?.deploy ?? null;
  return {
    id: asString(l.id),
    author,
    service,
    version: asString(l.version),
    environment: asString(l.environment),
    status,
    description: asString(l.description),
    commitSha,
    commitUrl: commitLink(l, commitSha),
    deployedAt: main.time,
    history: { previous, rollback },
    fixPlan: null,
    source: 'fallback',
  };
}

/** "carla.m" -> "CM", "dev" -> "DE", "Ana Lopez" -> "AL". */
export function handleInitials(handle: string | null | undefined): string {
  const clean = (handle ?? '').replace(/@.*$/, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s._\-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : clean.slice(0, 2);
  return letters.toUpperCase();
}

/** "2026-10-08T08:40:00Z" -> "08:40 UTC". */
export function utcClock(iso: string | null | undefined): string | null {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** "2026-10-08T08:40:00Z" -> "Oct 8". */
export function utcShortDay(iso: string | null | undefined): string | null {
  const d = iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "web-checkout v2.14.0", or whichever half is known. */
export function culpritChange(c: Pick<Culprit, 'service' | 'version'>): string {
  return [c.service, c.version].filter(Boolean).join(' ') || 'a change';
}

export interface CausedByParts {
  before: string;
  handle: string;
  /** Text inside the parentheses after the handle, e.g. "web-checkout v2.14.0". */
  detail: string | null;
  after: string;
}

/**
 * Splits a notification message around "Caused by <handle> (...)" so the
 * handle can be drawn as a chip. Conservative: the handle must be a single
 * token of handle characters, otherwise null (render plain text).
 */
export function parseCausedBy(text: string | null | undefined): CausedByParts | null {
  if (!text) return null;
  const m = /Caused by ([A-Za-z0-9][A-Za-z0-9._@-]{0,63})(?: \(([^()]{1,120})\))?/.exec(text);
  if (!m) return null;
  let handle = m[1]!;
  let tail = '';
  while (/[.\-@_]$/.test(handle)) {
    tail = handle.slice(-1) + tail;
    handle = handle.slice(0, -1);
  }
  if (!handle) return null;
  const end = m.index + m[0].length;
  return {
    before: text.slice(0, m.index),
    handle,
    detail: m[2] && !tail ? m[2] : null,
    after: (m[2] && tail ? `${tail} (${m[2]})` : tail) + text.slice(end),
  };
}
