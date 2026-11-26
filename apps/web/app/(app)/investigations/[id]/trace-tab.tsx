import type { ReactNode } from 'react';
import { TaskStatusPill } from '@helix/ui';
import type { InvestigationTrace, TraceContextSnapshot, TraceTask } from '../../../../lib/api';
import { formatDate } from '../../../../lib/investigations';
import { formatNumber } from '../../../../lib/format';
import {
  agentLabel,
  formatMs,
  messageTransport,
  messagesForTask,
  plannerLabel,
  readSnapshot,
  snapshotForTask,
  type SnapshotView,
} from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';

/** Per-task context snapshots, decisions, A2A messages and raw records. */
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

  return (
    <div className="space-y-4">
      <Panel title="Run" subtitle="How the Coordinator planned and wrote this investigation">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Planner', plannerLabel(trace.meta)],
            ['Summary writer', meta.summaryWriter ?? '-'],
            ['LLM model', meta.llmModel ?? '-'],
            ['LLM calls', meta.llmCalls != null ? String(meta.llmCalls) : '-'],
            ['Messages', String(trace.messages.length)],
            ['Context snapshots', String(trace.contextSnapshots.length)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
              <dd className="mt-1 break-words text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        {llmErrors.length > 0 && (
          <div className="mt-4 rounded-lg bg-[#fdf3f3] px-3 py-2 text-xs text-[var(--text-bad)]">
            <p className="font-medium">LLM fell back to rules</p>
            <ul className="mt-1 list-disc pl-4">
              {llmErrors.map((e, i) => (
                <li key={i}>{String(e)}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-[var(--text-muted)]">No agent tasks were recorded for this investigation.</p>
        </Panel>
      ) : (
        rows.map(({ task, snapshot }) => <TaskTrace key={task.id} trace={trace} task={task} snapshot={snapshot} />)
      )}

      {orphanSnapshots.length > 0 && (
        <Panel title="Other context snapshots" subtitle="Snapshots not linked to a persisted task">
          <div className="space-y-4">
            {orphanSnapshots.map((s) => (
              <SnapshotDetails key={s.id} view={readSnapshot(s)} label={`${agentLabel(s.agentType)} · ${formatDate(s.createdAt)}`} />
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

  return (
    <Panel>
      <article aria-label={`${agentLabel(task.agentType)} task`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{agentLabel(task.agentType)} agent</h3>
              <TaskStatusPill status={task.status} />
            </div>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{task.objective}</p>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {[
              ['Started', formatDate(task.startedAt)],
              ['Completed', formatDate(task.completedAt)],
              ['Duration', duration ?? '-'],
              ['Findings', String(raw.findings.length)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </header>
        {task.error && <p className="mt-2 rounded-md bg-[#fdf3f3] px-2 py-1 text-xs text-[var(--text-bad)]">{task.error}</p>}

        <div className="mt-4 space-y-3">
          {snapshot ? (
            <SnapshotDetails view={readSnapshot(snapshot)} label="Context snapshot" />
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No context snapshot recorded for this task.</p>
          )}

          <Section title={`Messages (${messages.length})`} defaultOpen={messages.length > 0}>
            {messages.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No A2A messages recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-lg border border-[var(--grid)] px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 font-mono text-[10px] font-medium">{m.type}</span>
                      <span>
                        {m.fromAgent.toLowerCase()} → {m.toAgent.toLowerCase()}
                      </span>
                      {messageTransport(m) && <span className="text-[var(--text-muted)]">via {messageTransport(m)}</span>}
                      <time dateTime={m.createdAt} className="ml-auto text-[10px] text-[var(--text-muted)]">
                        {formatDate(m.createdAt)}
                      </time>
                    </div>
                    {m.payload && Object.keys(m.payload).length > 0 && (
                      <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-[var(--canvas)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
                        {JSON.stringify(m.payload, null, 2)}
                      </pre>
                    )}
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
        </div>
      </article>
    </Panel>
  );
}

function SnapshotDetails({ view, label }: { view: SnapshotView; label: string }) {
  const { focus } = view;
  const hasFocus = focus.anomalyDates.length > 0 || focus.metricKeys.length > 0 || focus.direction;
  return (
    <div className="rounded-lg border border-[var(--grid)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">{label}</p>
        {view.source && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              view.source === 'fallback' ? 'bg-[#fdeee6] text-[#9a3f18]' : 'bg-[var(--canvas)] text-[var(--text-secondary)]'
            }`}
          >
            {view.source}
          </span>
        )}
        <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
          {view.tokenCount != null ? `${formatNumber(view.tokenCount)} tokens` : 'token count unknown'}
        </span>
        {view.truncated && (
          <span className="rounded bg-[#fff6e0] px-1.5 py-0.5 text-[10px] font-medium text-[#7a5a00]">truncated to budget</span>
        )}
      </div>

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Focus</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {hasFocus ? (
              <>
                {focus.anomalyDates.map((d) => (
                  <Chip key={`d-${d}`}>{d}</Chip>
                ))}
                {focus.metricKeys.map((k) => (
                  <Chip key={`m-${k}`}>{k}</Chip>
                ))}
                {focus.direction && <Chip>{focus.direction}</Chip>}
              </>
            ) : (
              <span className="text-[var(--text-muted)]">none</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Upstream</dt>
          <dd className="mt-1">
            {view.upstream.findings} findings, {view.upstream.evidence} evidence
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">History</dt>
          <dd className="mt-1">
            {view.history.metrics} metrics, {view.history.anomalies} anomalies, {view.history.findings} past findings
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        <Section title={`Data sources (${view.dataSources.length})`}>
          {view.dataSources.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No data sources were handed to this task.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {view.dataSources.map((ds, i) => (
                <li key={`${ds.name}-${i}`}>
                  <span className="font-mono">{ds.name}</span>{' '}
                  <span className="text-[var(--text-muted)]">{ds.type.toLowerCase()}</span>
                  {ds.tables.length > 0 && <span className="text-[var(--text-secondary)]">: {ds.tables.join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Decisions (${view.decisions.length})`} defaultOpen={view.decisions.length > 0}>
          {view.decisions.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No decisions recorded.</p>
          ) : (
            <ol className="space-y-2">
              {view.decisions.map((d, i) => (
                <li key={i} className="border-l-2 border-[var(--border)] pl-2.5 text-xs">
                  <p>
                    <span className="font-mono font-medium">{d.rule}</span>
                    {d.reason && <span className="text-[var(--text-secondary)]">: {d.reason}</span>}
                  </p>
                  {(d.kept.length > 0 || d.dropped.length > 0) && (
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {d.kept.length > 0 && <>kept {d.kept.join(', ')}</>}
                      {d.kept.length > 0 && d.dropped.length > 0 && '; '}
                      {d.dropped.length > 0 && <>dropped {d.dropped.join(', ')}</>}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title="Full assembled context">
          <Json value={view.raw} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="cursor-pointer list-none rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>{' '}
        {title}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 font-mono text-[11px]">{children}</span>;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-[var(--canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
