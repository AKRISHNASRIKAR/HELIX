import Link from 'next/link';
import { TaskStatusPill } from '@helix/ui';
import type {
  EvidenceItem,
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
  buildRootCauseStory,
  readCulprit,
  contributingFindings,
  metricSeriesById,
  plannerLabel,
  readAnomaly,
  recommendationFindings,
  triggerContextRows,
  type MetricSeries,
  type SeriesPoint,
} from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';
import { CueOnView, Reveal, Stagger } from '../../../../components/motion';
import { linkClass } from '../../../../components/ui';
import { StoryHero } from './result/story-hero';
import { ConfidenceMeter, ConfidenceRing } from './result/charts';
import { EvidenceVisual } from './result/evidence-visual';

const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-[var(--status-critical)] text-[var(--accent-contrast)] shadow-[0_0_14px_var(--anomaly-fill)]',
  HIGH: 'bg-[var(--accent)] text-[var(--accent-contrast)]',
  MEDIUM: 'border border-[var(--border-strong)] text-[var(--text-primary)]',
  LOW: 'border border-[var(--border)] text-[var(--text-muted)]',
};

const AGENT_ORDER = ['ANALYTICS', 'FINANCE', 'CUSTOMER', 'PRODUCT', 'COORDINATOR'];

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
  const story = trace ? buildRootCauseStory(trace) : null;
  const series = trace ? metricSeriesById(trace) : new Map<string, MetricSeries>();

  // Findings grouped by agent, in plan order (Coordinator last).
  const planOrder = new Map(steps.map((s) => [s.agentType, s.order]));
  const rank = (a: string) => planOrder.get(a) ?? 100 + (AGENT_ORDER.indexOf(a) + 1 || 50);
  const groups = [...new Set(findings.map((f) => f.agentType))]
    .sort((a, b) => (a === 'COORDINATOR' ? 1 : b === 'COORDINATOR' ? -1 : rank(a) - rank(b)))
    .map((agent) => ({
      agent,
      objective: steps.find((s) => s.agentType === agent)?.objective ?? null,
      findings: findings
        .filter((f) => f.agentType === agent)
        .sort((a, b) => Number(b.isRootCause) - Number(a.isRootCause) || b.confidence - a.confidence),
    }));

  return (
    <div className="space-y-8">
      {autonomous && <TriggerCard rows={triggerContextRows(triggerContext)} monitor={monitor} />}

      {story ? (
        <StoryHero story={story} contributors={contributors.length} culprit={trace ? readCulprit(trace) : null} />
      ) : (
        rootCause && (
          <CueOnView cue="rootCause">
            <section
              aria-label="Root cause"
              className="helix-beam flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-[var(--shadow-lg)]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Root cause found</p>
                <p className="mt-2 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{rootCause.statement}</p>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  {agentLabel(rootCause.agentType)} agent, {rootCause.analyticsType.toLowerCase()} analysis
                </p>
              </div>
              <ConfidenceRing value={rootCause.confidence} />
            </section>
          </CueOnView>
        )
      )}

      <Reveal>
        <Panel title="Summary">
          {investigation.summary ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">{investigation.summary}</p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{emptySummaryCopy(investigation.status)}</p>
          )}
        </Panel>
      </Reveal>

      <section className="space-y-4" aria-labelledby="findings-heading">
        <CueOnView cue="finding">
          <SectionHeading
            id="findings-heading"
            title="What each agent found"
            caption={
              findings.length > 0
                ? `${findings.length} finding${findings.length === 1 ? '' : 's'} from ${groups.length} agent${groups.length === 1 ? '' : 's'}, each backed by evidence`
                : undefined
            }
          />
        </CueOnView>
        {findings.length === 0 ? (
          <Panel>
            <p className="text-sm text-[var(--text-muted)]">
              {active ? 'Findings appear as agents complete their tasks.' : 'No findings were recorded for this investigation.'}
            </p>
          </Panel>
        ) : (
          groups.map((g, gi) => (
            <div key={g.agent} className="space-y-3">
              <Reveal className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[var(--accent-contrast)]">
                  {gi + 1}
                </span>
                <h3 className="text-sm font-semibold">
                  {agentLabel(g.agent)} agent{' '}
                  <span className="font-normal text-[var(--text-muted)]">
                    {g.findings.length} finding{g.findings.length === 1 ? '' : 's'}
                  </span>
                </h3>
                {g.objective && <p className="w-full text-xs text-[var(--text-muted)] sm:ml-9">{g.objective}</p>}
              </Reveal>
              <Stagger className="grid gap-3 lg:grid-cols-2" step={0.08}>
                {g.findings.map((f, i) => (
                  <FindingCard key={f.id ?? `${i}-${f.statement}`} finding={f} series={series} />
                ))}
              </Stagger>
            </div>
          ))
        )}
      </section>

      {recommendations.length > 0 && (
        <section className="space-y-4" aria-labelledby="recs-heading">
          <SectionHeading id="recs-heading" title="What to do next" caption={`${recommendations.length} action${recommendations.length === 1 ? '' : 's'}, most urgent first`} />
          <Stagger className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" step={0.07}>
            {[...recommendations]
              .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
              .map((r, i) => {
                const why = r.id ? (justifications.get(r.id) ?? []) : [];
                return (
                  <article
                    key={r.id ?? `${i}-${recommendationTitle(r)}`}
                    className={`flex h-full flex-col rounded-2xl border bg-[var(--surface)] p-4 shadow-[var(--shadow)] transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-[var(--border-strong)] ${
                      r.priority === 'CRITICAL' ? 'border-[var(--status-critical)]/50' : 'border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold tabular-nums">
                        {i + 1}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.MEDIUM}`}
                      >
                        {r.priority.toLowerCase()}
                      </span>
                    </div>
                    <h3 className="mt-3 text-sm font-semibold leading-snug">{recommendationTitle(r)}</h3>
                    {r.description && <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{r.description}</p>}
                    {r.expectedImpact && (
                      <p className="mt-3 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                        <span className="font-semibold text-[var(--text-primary)]">Impact </span>
                        {r.expectedImpact}
                      </p>
                    )}
                    {why.length > 0 && (
                      <div className="mt-auto pt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Justified by</p>
                        <ul className="mt-1 space-y-1">
                          {why.map((f) => (
                            <li key={f.id} className="border-l-2 border-[var(--border-strong)] pl-2 text-xs text-[var(--text-secondary)]">
                              <span className="font-medium text-[var(--text-primary)]">{agentLabel(f.agentType)}:</span> {f.statement}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
          </Stagger>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title={meta?.planner ? `Plan, ${plannerLabel(meta)}` : 'Plan'}
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
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border)]">
                    {step.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{agentLabel(step.agentType)} agent</p>
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
                      <p className="mt-1.5 rounded-md bg-[var(--anomaly-fill)] px-2 py-1 text-xs text-[var(--text-bad)]">{step.task.error}</p>
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

function SectionHeading({ id, title, caption }: { id: string; title: string; caption?: string }) {
  return (
    <div>
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {caption && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{caption}</p>}
    </div>
  );
}

function priorityRank(p: string): number {
  return ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(p) + 1 || 9;
}

function TriggerCard({
  rows,
  monitor,
}: {
  rows: { label: string; value: string }[];
  monitor: { id: string; name: string } | null;
}) {
  return (
    <Reveal>
      <section
        aria-label="Trigger"
        className="relative overflow-hidden rounded-2xl border border-[var(--status-critical)]/30 bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[var(--anomaly-fill)] opacity-60" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-bad)]">Opened autonomously</p>
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
          <dl className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {rows.map((r) => (
              <div key={r.label}>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{r.label}</dt>
                <dd className={`mt-0.5 break-words text-sm font-medium tabular-nums ${r.label === 'Change' ? 'text-[var(--text-bad)]' : ''}`}>
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </Reveal>
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

/** The daily series an anomaly evidence row was detected in, when an agent recorded it. */
function seriesFor(item: EvidenceItem, series: Map<string, MetricSeries>): SeriesPoint[] | null {
  const a = readAnomaly(item.data);
  return a?.metricId ? (series.get(a.metricId)?.series ?? null) : null;
}

function FindingCard({ finding: f, series }: { finding: InvestigationFinding; series: Map<string, MetricSeries> }) {
  const items = f.evidenceItems ?? [];
  // The root cause card links every contributing item; show the first few and leave the rest in details.
  const shown = f.isRootCause ? items.filter((i) => (i.data as { kind?: string } | null)?.kind === 'root_cause_ranking') : items.slice(0, 2);
  return (
    <article
      className={`flex h-full flex-col rounded-2xl border bg-[var(--surface)] p-4 shadow-[var(--shadow)] transition-colors hover:border-[var(--border-strong)] ${
        f.isRootCause ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent),0_0_32px_-8px_var(--glow-strong)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {f.analyticsType.toLowerCase()}
          {f.isRootCause && (
            <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] tracking-wide text-[var(--accent-contrast)]">root cause</span>
          )}
        </p>
        <ConfidenceMeter value={f.confidence} />
      </div>
      <p className="mt-2 text-sm font-medium leading-snug">{f.statement}</p>

      {shown.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Evidence">
          {shown.map((item) => (
            <li key={item.id} className="rounded-xl border border-[var(--grid)] bg-[var(--surface-2)] p-3">
              <EvidenceVisual data={item.data} series={seriesFor(item, series)} />
            </li>
          ))}
        </ul>
      )}
      {shown.length === 0 && f.evidence.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Evidence">
          {f.evidence.map((e, i) => (
            <li key={`${i}-${e}`} className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
              {e}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <details className="group mt-auto pt-3">
          <summary className="cursor-pointer list-none rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              ▸
            </span>{' '}
            Evidence details ({items.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-[var(--grid)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
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
    </article>
  );
}
