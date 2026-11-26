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
