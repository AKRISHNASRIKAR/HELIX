import Link from 'next/link';
import { TaskStatusPill } from '@helix/ui';
import type {
  InvestigationDetail,
  InvestigationEvent,
  InvestigationFinding,
  InvestigationTrace,
  TraceFinding,
} from '../../../../lib/api';
import {
  formatDate,
  formatDuration,
  formatEventType,
  isActiveStatus,
  joinStepsWithTasks,
  recommendationTitle,
} from '../../../../lib/investigations';
import { formatPercent, formatRelative } from '../../../../lib/format';
import {
  agentLabel,
  contributingFindings,
  plannerLabel,
  recommendationFindings,
  triggerContextRows,
} from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';
import { ConfidenceBar, linkClass } from '../../../../components/ui';

const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-[#fbe4e4] text-[var(--text-bad)]',
  HIGH: 'bg-[#fdeee6] text-[#9a3f18]',
  MEDIUM: 'bg-[var(--canvas)] text-[var(--text-secondary)]',
  LOW: 'bg-[var(--canvas)] text-[var(--text-muted)]',
};

export function OverviewTab({
  investigation,
  trace,
}: {
  investigation: InvestigationDetail;
  trace: InvestigationTrace | null;
}) {
  const active = isActiveStatus(investigation.status);
  const findings = investigation.findings ?? [];
  const recommendations = investigation.recommendations ?? [];
  const steps = joinStepsWithTasks(investigation);
  const events = [...(investigation.events ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const rootCause =
    findings.find((f) => f.id && f.id === investigation.rootCauseFindingId) ?? findings.find((f) => f.isRootCause);
  const contributors = trace && rootCause?.id ? contributingFindings(trace, rootCause.id) : [];
  const justifications = trace ? recommendationFindings(trace) : new Map<string, TraceFinding[]>();
  const triggerContext = investigation.triggerContext ?? trace?.investigation.triggerContext ?? null;
  const monitor = investigation.monitor ?? trace?.investigation.monitor ?? null;
  const autonomous = String(investigation.triggerType) === 'ANOMALY_DETECTED';
  const meta = investigation.meta ?? trace?.meta ?? null;

  return (
    <div className="space-y-6">
      {autonomous && (
        <TriggerCard rows={triggerContextRows(triggerContext)} monitor={monitor} />
      )}

      {rootCause && (
        <section
          aria-label="Root cause"
          className="rounded-xl border border-[var(--series-1)] bg-[#f3f8fe] p-5 ring-1 ring-[var(--series-1)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#1d5fae]">
              Root cause
              {rootCause.agentType === 'COORDINATOR' && (
                <span className="ml-2 rounded bg-[#dceafb] px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal">
                  Coordinator synthesis
                </span>
              )}
            </p>
            <ConfidenceBar value={rootCause.confidence} />
          </div>
          <p className="mt-2 text-base font-medium leading-snug">{rootCause.statement}</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {rootCause.agentType === 'COORDINATOR'
              ? `ranked from ${contributors.length || 'the'} contributing finding${contributors.length === 1 ? '' : 's'}`
              : `${rootCause.agentType.toLowerCase()} agent · ${rootCause.analyticsType.toLowerCase()} analysis`}
          </p>
          {contributors.length > 0 && (
            <div className="mt-3 border-t border-[#cfe0f5] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#1d5fae]">Contributing findings</p>
              <ul className="mt-1.5 space-y-1.5">
                {contributors.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 text-[13px]">
                    <span className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                      {agentLabel(f.agentType)}
                    </span>
                    <span className="min-w-0 flex-1 text-[var(--text-secondary)]">{f.statement}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                      {formatPercent(f.confidence, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <Panel title="Summary">
        {investigation.summary ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">{investigation.summary}</p>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{emptySummaryCopy(investigation.status)}</p>
        )}
      </Panel>

      <section className="space-y-3" aria-labelledby="findings-heading">
        <h2 id="findings-heading" className="text-sm font-semibold">
          Findings {findings.length > 0 && <span className="font-normal text-[var(--text-muted)]">({findings.length})</span>}
        </h2>
        {findings.length === 0 ? (
          <Panel>
            <p className="text-sm text-[var(--text-muted)]">
              {active ? 'Findings appear as agents complete their tasks.' : 'No findings were recorded for this investigation.'}
            </p>
          </Panel>
        ) : (
          findings.map((f, i) => <FindingCard key={f.id ?? `${i}-${f.statement}`} finding={f} />)
        )}
      </section>

      {recommendations.length > 0 && (
        <Panel className="!p-0">
          <h2 className="px-5 pb-1 pt-5 text-sm font-semibold">Recommendations</h2>
          <ul className="divide-y divide-[var(--grid)]">
            {recommendations.map((r, i) => {
              const why = r.id ? (justifications.get(r.id) ?? []) : [];
              return (
                <li key={r.id ?? `${i}-${recommendationTitle(r)}`} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{recommendationTitle(r)}</p>
                    {r.description && <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{r.description}</p>}
                    {r.expectedImpact && (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">Expected impact: {r.expectedImpact}</p>
                    )}
                    {why.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Justified by</p>
                        <ul className="mt-1 space-y-1">
                          {why.map((f) => (
                            <li key={f.id} className="border-l-2 border-[var(--border)] pl-2 text-xs text-[var(--text-secondary)]">
                              <span className="font-medium">{agentLabel(f.agentType)}:</span> {f.statement}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.MEDIUM}`}
                  >
                    {r.priority.toLowerCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title={meta?.planner ? `Plan · ${plannerLabel(meta)}` : 'Plan'}
          subtitle={investigation.plan?.reasoning ?? undefined}
          className="!pb-2"
        >
          {steps.length === 0 ? (
            <p className="pb-3 text-sm text-[var(--text-muted)]">
              {active ? 'The Coordinator is planning which agents to involve.' : 'No plan was produced.'}
            </p>
          ) : (
            <ol className="-mx-5 divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
              {steps.map((step) => (
                <li key={step.key} className="flex gap-3 px-5 py-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--canvas)] text-xs font-medium text-[var(--text-secondary)]">
                    {step.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{step.agentType.toLowerCase()} agent</p>
                      {step.task && <TaskStatusPill status={step.task.status} />}
                      {step.task && formatDuration(step.task.startedAt, step.task.completedAt) && (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {formatDuration(step.task.startedAt, step.task.completedAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{step.objective}</p>
                    {step.dependsOn.length > 0 && (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        after step{step.dependsOn.length > 1 ? 's' : ''} {step.dependsOn.join(', ')}
                      </p>
                    )}
                    {step.task?.error && (
                      <p className="mt-1.5 rounded-md bg-[#fdf3f3] px-2 py-1 text-xs text-[var(--text-bad)]">{step.task.error}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Timeline" subtitle={events.length > 0 ? `${events.length} events` : undefined}>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No events recorded yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-[var(--border)] pl-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--surface)] ${eventDot(e.type)}`}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[13px] font-medium">{formatEventType(e.type)}</p>
                    <time dateTime={e.createdAt} title={formatDate(e.createdAt)} className="text-[11px] text-[var(--text-muted)]">
                      {formatRelative(e.createdAt)}
                    </time>
                  </div>
                  {eventDetail(e) && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{eventDetail(e)}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TriggerCard({
  rows,
  monitor,
}: {
  rows: { label: string; value: string }[];
  monitor: { id: string; name: string } | null;
}) {
  return (
    <section aria-label="Trigger" className="rounded-xl border border-[#f3d3c2] bg-[#fdf6f2] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9a3f18]">Opened autonomously</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {monitor ? (
              <>
                Monitor <span className="font-medium text-[var(--text-primary)]">{monitor.name}</span> detected an anomaly
                and opened this investigation.
              </>
            ) : (
              'A monitor detected an anomaly and opened this investigation.'
            )}
          </p>
        </div>
        <Link href="/monitoring" className={`text-xs font-medium ${linkClass}`}>
          Monitoring →
        </Link>
      </div>
      {rows.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{r.label}</dt>
              <dd className="mt-0.5 break-words text-sm tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function emptySummaryCopy(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Queued. The Coordinator will pick this up shortly.';
    case 'PLANNING':
      return 'The Coordinator is planning the investigation.';
    case 'IN_PROGRESS':
    case 'AWAITING_EVIDENCE':
      return 'Agents are gathering evidence. A summary appears when they finish.';
    case 'CANCELLED':
      return 'This investigation was cancelled before a summary was produced.';
    case 'FAILED':
      return 'The investigation failed before producing a summary. Check the plan and timeline for errors.';
    default:
      return 'No summary was produced.';
  }
}

function eventDot(type: string): string {
  if (type.endsWith('failed')) return 'bg-[var(--status-critical)]';
  if (type.endsWith('completed') || type.endsWith('synthesized')) return 'bg-[var(--status-good)]';
  if (type.endsWith('cancelled')) return 'bg-[var(--text-muted)]';
  return 'bg-[var(--series-1)]';
}

/** One short line of context from an event payload, when there's something useful. */
function eventDetail(e: InvestigationEvent): string | null {
  const p = e.payload ?? {};
  if (typeof p.error === 'string') return p.error;
  if (typeof p.agentType === 'string' && typeof p.objective === 'string') {
    return `${p.agentType.toLowerCase()}: ${p.objective}`;
  }
  if (typeof p.findings === 'number') return `${p.findings} finding${p.findings === 1 ? '' : 's'}`;
  if (typeof p.overallConfidence === 'number') return `confidence ${formatPercent(p.overallConfidence, 0)}`;
  return null;
}

function FindingCard({ finding: f }: { finding: InvestigationFinding }) {
  const items = f.evidenceItems ?? [];
  return (
    <Panel className={f.isRootCause ? 'border-[var(--series-1)]' : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {f.agentType.toLowerCase()} agent · {f.analyticsType.toLowerCase()}
            {f.isRootCause && (
              <span className="ml-2 rounded bg-[var(--series-1)] px-1.5 py-0.5 text-[10px] text-white">ROOT CAUSE</span>
            )}
          </p>
          <p className="mt-1 text-sm font-medium">{f.statement}</p>
          {f.evidence.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Evidence">
              {f.evidence.map((e, i) => (
                <li key={`${i}-${e}`} className="rounded-md bg-[var(--canvas)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
        <ConfidenceBar value={f.confidence} />
      </div>
      {items.length > 0 && (
        <details className="group mt-3 border-t border-[var(--grid)] pt-3">
          <summary className="cursor-pointer list-none rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              ▸
            </span>{' '}
            Evidence details ({items.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-[var(--grid)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    {item.sourceType.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {item.confidence != null && (
                    <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {formatPercent(item.confidence, 0)} confidence
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13px]">{item.summary}</p>
                {item.data != null && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-[var(--canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {JSON.stringify(item.data, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
