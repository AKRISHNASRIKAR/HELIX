import type { ReactNode } from 'react';
import { TaskStatusPill } from '@helix/ui';
import type { InvestigationTrace, TraceContextSnapshot, TraceTask } from '../../../../lib/api';
import { formatDate } from '../../../../lib/investigations';
import {
  agentLabel,
  buildSequence,
  formatMs,
  messageTransport,
  messagesForTask,
  plannerLabel,
  readSnapshot,
  snapshotBudget,
  snapshotForTask,
  type SnapshotView,
} from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';
import { Reveal, Stagger } from '../../../../components/motion';
import { BudgetBar, DecisionList, SequenceDiagram } from './result/trace-visuals';

/**
 * Makes the context engine visible: per agent what it was handed (tables,
 * focus days, history, token budget) and the decisions behind it, then the
 * A2A messages as a sequence diagram. Raw JSON stays one click away.
 */
export function TraceTab({ trace }: { trace: InvestigationTrace }) {
  const meta = trace.meta ?? {};
  const stepOrder = new Map(trace.steps.map((s) => [s.id, s.order]));
  const tasks = [...trace.tasks].sort(
    (a, b) =>
      (stepOrder.get(a.stepId ?? '') ?? 999) - (stepOrder.get(b.stepId ?? '') ?? 999) ||
      String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  const matched = new Set<string>();
  const rows = tasks.map((t) => {
    const snap = snapshotForTask(trace.contextSnapshots, t);
    if (snap) matched.add(snap.id);
    return { task: t, snapshot: snap };
  });
  const orphanSnapshots = trace.contextSnapshots.filter((s) => !matched.has(s.id));
  const llmErrors = Array.isArray(meta.llmErrors) ? meta.llmErrors : [];
  const sequence = buildSequence(trace);

  const stats: [string, string][] = [
    ['Planner', plannerLabel(trace.meta)],
    ['Summary writer', meta.summaryWriter ?? '-'],
    ['LLM model', meta.llmModel ?? '-'],
    ['LLM calls', meta.llmCalls != null ? String(meta.llmCalls) : '-'],
    ['Messages', String(trace.messages.length)],
    ['Context snapshots', String(trace.contextSnapshots.length)],
  ];

  return (
    <div className="space-y-8">
      <Reveal>
        <Panel title="Run" subtitle="How the Coordinator planned and wrote this investigation">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[var(--grid)] bg-[var(--surface-2)] px-3 py-2.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {llmErrors.length > 0 && (
            <div className="mt-4 rounded-lg bg-[var(--anomaly-fill)] px-3 py-2 text-xs text-[var(--text-bad)]">
              <p className="font-medium">LLM fell back to rules</p>
              <ul className="mt-1 list-disc pl-4">
                {llmErrors.map((e, i) => (
                  <li key={i}>{String(e)}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </Reveal>

      <section className="space-y-3" aria-labelledby="context-heading">
        <div>
          <h2 id="context-heading" className="text-lg font-semibold tracking-tight">
            What each agent was given
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            The context engine picks the tables, focus days and history each agent sees, and trims it to a token budget.
          </p>
        </div>
        {rows.length === 0 ? (
          <Panel>
            <p className="text-sm text-[var(--text-muted)]">No agent tasks were recorded for this investigation.</p>
          </Panel>
        ) : (
          <Stagger className="grid gap-4 xl:grid-cols-2" step={0.1}>
            {rows.map(({ task, snapshot }) => (
              <TaskTrace key={task.id} trace={trace} task={task} snapshot={snapshot} />
            ))}
          </Stagger>
        )}
      </section>

      <Reveal>
        <Panel title="A2A messages" subtitle="Every hop between the Coordinator and the agents, in time order. Solid = request, dashed = result.">
          <SequenceDiagram lanes={sequence.lanes} arrows={sequence.arrows} />
        </Panel>
      </Reveal>

      {orphanSnapshots.length > 0 && (
        <Panel title="Other context snapshots" subtitle="Snapshots not linked to a persisted task">
          <div className="space-y-4">
            {orphanSnapshots.map((s) => (
              <div key={s.id} className="rounded-xl border border-[var(--grid)] p-3">
                <p className="mb-3 text-xs font-semibold">
                  {agentLabel(s.agentType)}, {formatDate(s.createdAt)}
                </p>
                <ContextGiven view={readSnapshot(s)} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function TaskTrace({
  trace,
  task,
  snapshot,
}: {
  trace: InvestigationTrace;
  task: TraceTask;
  snapshot: TraceContextSnapshot | null;
}) {
  const messages = messagesForTask(trace.messages, task.id);
  const findingIds = new Set(task.findingIds ?? []);
  const evidenceIds = new Set(task.evidenceIds ?? []);
  const raw = {
    task: { ...task, result: undefined },
    findings: trace.findings.filter((f) => findingIds.has(f.id) || f.agentTaskId === task.id),
    evidence: trace.evidence.filter((e) => evidenceIds.has(e.id) || e.agentTaskId === task.id),
  };
  const duration = formatMs(task.durationMs);
  const failed = /FAIL/.test(task.status);

  return (
    <article
      aria-label={`${agentLabel(task.agentType)} task`}
      className={`h-full rounded-2xl border bg-[var(--surface)] p-5 shadow-[var(--shadow)] transition-colors hover:border-[var(--border-strong)] ${
        failed ? 'border-[var(--status-critical)]/50' : 'border-[var(--border)]'
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-[var(--accent-contrast)] shadow-[0_0_16px_-4px_var(--glow-strong)]">
            {agentLabel(task.agentType).charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{agentLabel(task.agentType)} agent</h3>
              <TaskStatusPill status={task.status} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-secondary)]" title={task.objective}>
              {task.objective}
            </p>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {[
            ['Duration', duration ?? '-'],
            ['Findings', String(raw.findings.length)],
            ['Evidence', String(raw.evidence.length)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Started {formatDate(task.startedAt)}, completed {formatDate(task.completedAt)}
      </p>
      {task.error && <p className="mt-2 rounded-md bg-[var(--anomaly-fill)] px-2 py-1 text-xs text-[var(--text-bad)]">{task.error}</p>}

      <div className="mt-4 space-y-4">
        {snapshot ? (
          <ContextGiven view={readSnapshot(snapshot)} />
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No context snapshot recorded for this task.</p>
        )}

        <div className="space-y-2 border-t border-[var(--grid)] pt-3">
          <Section title={`Messages (${messages.length})`}>
            {messages.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No A2A messages recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-lg border border-[var(--grid)] px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${m.type === 'ERROR' ? 'bg-[var(--anomaly-fill)] text-[var(--text-bad)]' : 'bg-[var(--surface-2)]'}`}>
                        {m.type}
                      </span>
                      <span>
                        {agentLabel(m.fromAgent)} → {agentLabel(m.toAgent)}
                      </span>
                      {messageTransport(m) && <span className="text-[var(--text-muted)]">via {messageTransport(m)}</span>}
                      <time dateTime={m.createdAt} className="ml-auto text-[10px] text-[var(--text-muted)]">
                        {formatDate(m.createdAt)}
                      </time>
                    </div>
                    {m.payload && Object.keys(m.payload).length > 0 && <Json value={m.payload} small />}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {task.result != null && (
            <Section title="Raw result JSON">
              <Json value={task.result} />
            </Section>
          )}
          <Section title="Task record, findings and evidence">
            <Json value={raw} />
          </Section>
          {snapshot && (
            <Section title="Full assembled context">
              <Json value={snapshot.assembledContext} />
            </Section>
          )}
        </div>
      </div>
    </article>
  );
}

/** What one agent was handed: tables, focus, history, upstream, budget and decisions. */
function ContextGiven({ view }: { view: SnapshotView }) {
  const { focus } = view;
  const budget = snapshotBudget(view);
  const tables = view.dataSources.flatMap((ds) => (ds.tables.length ? ds.tables : [ds.name]).map((t) => ({ t, ds })));
  const droppedDays = view.decisions.find((d) => d.rule === 'focus')?.dropped ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        {view.source && (
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              view.source === 'fallback' ? 'bg-[var(--anomaly-fill)] text-[var(--text-bad)]' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border)]'
            }`}
          >
            assembled by {view.source}
          </span>
        )}
        {view.truncated && (
          <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 font-medium text-[var(--text-primary)]">trimmed to budget</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Given label="Tables">
          {tables.length === 0 ? (
            <span className="text-[var(--text-muted)]">none</span>
          ) : (
            tables.map(({ t, ds }) => (
              <Chip key={`${ds.name}-${t}`} title={`${ds.name} (${ds.type.toLowerCase()})`}>
                {t} <span className="text-[var(--text-muted)]">{ds.type.toLowerCase()}</span>
              </Chip>
            ))
          )}
        </Given>
        <Given label="Focus">
          {focus.anomalyDates.length === 0 && focus.metricKeys.length === 0 && !focus.direction ? (
            <span className="text-[var(--text-muted)]">none</span>
          ) : (
            <>
              {focus.anomalyDates.map((d) => (
                <Chip key={`d-${d}`} hot>
                  {d}
                </Chip>
              ))}
              {droppedDays.map((d) => (
                <Chip key={`x-${d}`} struck>
                  {d}
                </Chip>
              ))}
              {focus.metricKeys.map((k) => (
                <Chip key={`m-${k}`}>{k}</Chip>
              ))}
              {focus.direction && <Chip>{focus.direction}</Chip>}
            </>
          )}
        </Given>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {[
          ['Past metrics', view.history.metrics],
          ['Past anomalies', view.history.anomalies],
          ['Past findings', view.history.findings],
          ['Upstream findings', view.upstream.findings],
          ['Upstream evidence', view.upstream.evidence],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg bg-[var(--surface-2)] px-2.5 py-2 ring-1 ring-[var(--grid)]">
            <p className="text-lg font-semibold tabular-nums leading-none">{n}</p>
            <p className="mt-1 text-[10px] leading-tight text-[var(--text-muted)]">{label}</p>
          </div>
        ))}
      </div>

      <BudgetBar budget={budget} />

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Decisions ({view.decisions.length})
        </p>
        <DecisionList decisions={view.decisions} />
      </div>
    </div>
  );
}

function Given({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="cursor-pointer list-none rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>{' '}
        {title}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Chip({ children, hot = false, struck = false, title }: { children: ReactNode; hot?: boolean; struck?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${
        hot
          ? 'bg-[var(--anomaly-fill)] text-[var(--text-bad)] ring-1 ring-[var(--status-critical)]/30'
          : struck
            ? 'text-[var(--text-muted)] line-through ring-1 ring-[var(--border)]'
            : 'bg-[var(--surface-2)] ring-1 ring-[var(--border)]'
      }`}
    >
      {children}
    </span>
  );
}

function Json({ value, small = false }: { value: unknown; small?: boolean }) {
  return (
    <pre
      className={`${small ? 'mt-1.5 max-h-40' : 'max-h-96'} overflow-auto rounded-md bg-[var(--canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
