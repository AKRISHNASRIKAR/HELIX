/**
 * Phase 10 investigation trace: pure functions that turn the persisted trail
 * of one investigation into the `GET /investigations/:id/trace` payload,
 * including the evidence graph. No I/O so it is unit-testable.
 */

export interface TraceTaskRow {
  id: string;
  investigationStepId: string | null;
  agentType: string;
  status: string;
  objective: string;
  error: string | null;
  result: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface TraceEvidenceRow {
  id: string;
  agentTaskId: string;
  sourceType: string;
  source: unknown;
  summary: string;
  data: unknown;
  confidence: number;
  collectedAt: Date;
}

export interface TraceFindingRow {
  id: string;
  agentType: string;
  analyticsType: string;
  statement: string;
  confidence: number;
  isRootCause: boolean;
  evidenceIds: string[];
}

export interface TraceRecommendationRow {
  id: string;
  title: string;
  description: string;
  priority: string;
  expectedImpact: string | null;
  findingIds: string[];
}

export interface TraceStepRow {
  id: string;
  order: number;
  agentType: string;
  objective: string;
  dependsOn: unknown;
}

export interface TraceSnapshotRow {
  id: string;
  agentTaskId: string | null;
  agentType: string;
  tokenCount: number | null;
  createdAt: Date;
  assembledContext: unknown;
}

export interface TraceMessageRow {
  id: string;
  type: string;
  agentTaskId: string | null;
  fromAgent: string;
  toAgent: string;
  payload: unknown;
  correlationId: string;
  createdAt: Date;
}

export interface TraceEventRow {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export interface TraceInput {
  investigation: {
    id: string;
    question: string;
    status: string;
    triggerType: string;
    triggerContext: unknown;
    summary: string | null;
    overallConfidence: number | null;
    rootCauseFindingId: string | null;
    plan: unknown;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    monitor: { id: string; name: string } | null;
  };
  steps: TraceStepRow[];
  tasks: TraceTaskRow[];
  evidence: TraceEvidenceRow[];
  findings: TraceFindingRow[];
  recommendations: TraceRecommendationRow[];
  messages: TraceMessageRow[];
  contextSnapshots: TraceSnapshotRow[];
  events: TraceEventRow[];
}

export type GraphNodeType =
  'question' | 'step' | 'task' | 'evidence' | 'finding' | 'rootCause' | 'recommendation';
export type GraphEdgeKind = 'plans' | 'runs' | 'collected' | 'supports' | 'justifies' | 'selected';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  agentType?: string;
  confidence?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

const LABEL_MAX = 140;
const label = (text: string) =>
  text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 3)}...` : text;

const dependsOn = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];

/**
 * Task a finding came from. The root cause finding belongs to the
 * Coordinator's synthesis task; any other finding to the single task all its
 * evidence came from (null when that is ambiguous or there is no evidence).
 */
export function findingTaskIds(
  findings: TraceFindingRow[],
  evidence: TraceEvidenceRow[],
  tasks: TraceTaskRow[],
): Map<string, string | null> {
  const evidenceTask = new Map(evidence.map((e) => [e.id, e.agentTaskId]));
  const synthesis = [...tasks].reverse().find((t) => t.agentType === 'COORDINATOR');
  const out = new Map<string, string | null>();
  for (const f of findings) {
    if (f.isRootCause && synthesis) {
      out.set(f.id, synthesis.id);
      continue;
    }
    const owners = new Set(
      f.evidenceIds.map((id) => evidenceTask.get(id)).filter((t): t is string => !!t),
    );
    out.set(f.id, owners.size === 1 ? [...owners][0]! : null);
  }
  return out;
}

/** Run metadata (planner, summary writer, LLM usage) from the latest terminal event. */
export function runMeta(events: TraceEventRow[]): Record<string, unknown> {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'investigation.completed' && e.type !== 'investigation.failed') continue;
    const meta = (e.payload as { meta?: unknown } | null)?.meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      return meta as Record<string, unknown>;
    }
  }
  return {};
}

/**
 * question -plans-> step -runs-> task -collected-> evidence -supports-> finding
 * -justifies-> recommendation. The root cause finding is a `rootCause` node,
 * linked from the task that selected it (the synthesis task, else the question).
 */
export function buildGraph(
  input: TraceInput,
  taskOfFinding: Map<string, string | null>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ids = new Set<string>();
  const add = (n: GraphNode) => {
    if (ids.has(n.id)) return;
    ids.add(n.id);
    nodes.push(n);
  };
  const link = (from: string, to: string, kind: GraphEdgeKind) => {
    if (ids.has(from) && ids.has(to)) edges.push({ from, to, kind });
  };

  const inv = input.investigation;
  add({ id: inv.id, type: 'question', label: label(inv.question) });

  for (const s of [...input.steps].sort((a, b) => a.order - b.order)) {
    add({
      id: s.id,
      type: 'step',
      label: label(`${s.order}. ${s.agentType}: ${s.objective}`),
      agentType: s.agentType,
    });
    link(inv.id, s.id, 'plans');
  }
  for (const t of input.tasks) {
    add({ id: t.id, type: 'task', label: `${t.agentType} (${t.status})`, agentType: t.agentType });
    if (t.investigationStepId) link(t.investigationStepId, t.id, 'runs');
  }
  const taskType = new Map(input.tasks.map((t) => [t.id, t.agentType]));
  for (const e of input.evidence) {
    add({
      id: e.id,
      type: 'evidence',
      label: label(e.summary),
      agentType: taskType.get(e.agentTaskId),
      confidence: e.confidence,
    });
    link(e.agentTaskId, e.id, 'collected');
  }
  for (const f of input.findings) {
    const isRoot = f.isRootCause || f.id === inv.rootCauseFindingId;
    add({
      id: f.id,
      type: isRoot ? 'rootCause' : 'finding',
      label: label(f.statement),
      agentType: f.agentType,
      confidence: f.confidence,
    });
    for (const evidenceId of f.evidenceIds) link(evidenceId, f.id, 'supports');
    if (isRoot) link(taskOfFinding.get(f.id) ?? inv.id, f.id, 'selected');
  }
  for (const r of input.recommendations) {
    add({ id: r.id, type: 'recommendation', label: label(r.title) });
    for (const findingId of r.findingIds) link(findingId, r.id, 'justifies');
  }
  return { nodes, edges };
}

export function buildTrace(input: TraceInput) {
  const inv = input.investigation;
  const taskOfFinding = findingTaskIds(input.findings, input.evidence, input.tasks);
  const snapshotOfTask = new Map<string, string>();
  for (const c of input.contextSnapshots) {
    if (c.agentTaskId) snapshotOfTask.set(c.agentTaskId, c.id);
  }

  return {
    investigation: {
      id: inv.id,
      question: inv.question,
      status: inv.status,
      triggerType: inv.triggerType,
      triggerContext: inv.triggerContext ?? null,
      summary: inv.summary,
      overallConfidence: inv.overallConfidence,
      rootCauseFindingId: inv.rootCauseFindingId,
      createdAt: inv.createdAt,
      startedAt: inv.startedAt,
      completedAt: inv.completedAt,
      monitor: inv.monitor,
    },
    plan: inv.plan ?? null,
    meta: runMeta(input.events),
    steps: [...input.steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        order: s.order,
        agentType: s.agentType,
        objective: s.objective,
        dependsOn: dependsOn(s.dependsOn),
      })),
    tasks: input.tasks.map((t) => ({
      id: t.id,
      stepId: t.investigationStepId,
      agentType: t.agentType,
      status: t.status,
      objective: t.objective,
      error: t.error,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      durationMs:
        t.startedAt && t.completedAt ? t.completedAt.getTime() - t.startedAt.getTime() : null,
      contextSnapshotId: snapshotOfTask.get(t.id) ?? null,
      findingIds: input.findings.filter((f) => taskOfFinding.get(f.id) === t.id).map((f) => f.id),
      evidenceIds: input.evidence.filter((e) => e.agentTaskId === t.id).map((e) => e.id),
      result: t.result ?? null,
    })),
    messages: input.messages,
    contextSnapshots: input.contextSnapshots,
    events: input.events,
    evidence: input.evidence,
    findings: input.findings.map((f) => ({
      ...f,
      agentTaskId: taskOfFinding.get(f.id) ?? null,
    })),
    recommendations: input.recommendations,
    graph: buildGraph(input, taskOfFinding),
  };
}

export type InvestigationTrace = ReturnType<typeof buildTrace>;
