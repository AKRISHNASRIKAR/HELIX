import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@helix/ui';
import type { InvestigationStatus } from '@helix/types';
import { getInvestigation, getInvestigationTrace, isDemoMode, type InvestigationTrace } from '../../../../lib/api';
import { formatDate, formatTriggerType, isActiveStatus } from '../../../../lib/investigations';
import { buildGraphData, buildReplaySteps, formatMs } from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';
import { AutoRefresh } from '../../../../components/auto-refresh';
import { EmptyState, linkClass } from '../../../../components/ui';
import { CancelInvestigationButton } from './cancel-button';
import { OverviewTab } from './overview-tab';
import { ReplayPlayer } from './replay-player';
import { EvidenceGraph } from './evidence-graph';
import { TraceTab } from './trace-tab';
import { RunTheater } from './theater/run-theater';
import { PlayRunButton } from './theater/play-button';
import { ConfidenceRing } from './theater/confidence-ring';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'replay', label: 'Replay' },
  { key: 'graph', label: 'Evidence graph' },
  { key: 'trace', label: 'Trace' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function InvestigationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; play?: string }>;
}) {
  const [{ id }, { tab, play }] = await Promise.all([params, searchParams]);
  const [investigation, trace] = await Promise.all([getInvestigation(id), getInvestigationTrace(id)]);

  if (!investigation) notFound();

  const current: TabKey = TABS.find((t) => t.key === tab)?.key ?? 'overview';
  const active = isActiveStatus(investigation.status);
  const theaterOpen = play === '1';
  const canPlay = !!trace || active;
  const base = `/investigations/${investigation.id}`;
  const tabHref = (key: TabKey) => (key === 'overview' ? base : `${base}?tab=${key}`);
  const playHref = current === 'overview' ? `${base}?play=1` : `${base}?tab=${current}&play=1`;

  const startMs = investigation.startedAt ? new Date(investigation.startedAt).getTime() : NaN;
  const endMs = investigation.completedAt ? new Date(investigation.completedAt).getTime() : NaN;
  const duration = formatMs(endMs - startMs);
  const autonomous = String(investigation.triggerType) === 'ANOMALY_DETECTED';
  const agentCount = trace ? trace.tasks.filter((t) => t.agentType !== 'COORDINATOR').length : (investigation.tasks?.length ?? null);
  const findingCount = trace ? trace.findings.length : (investigation.findings?.length ?? null);
  const evidenceCount = trace ? trace.evidence.length : null;

  const stats = [
    { label: 'Run time', value: duration ?? (active ? 'running' : '-'), hint: 'start to finish' },
    { label: 'Agents', value: agentCount == null ? '-' : String(agentCount), hint: 'specialists briefed' },
    { label: 'Findings', value: findingCount == null ? '-' : String(findingCount), hint: 'reported' },
    { label: 'Evidence', value: evidenceCount == null ? '-' : String(evidenceCount), hint: 'items collected' },
  ];
  const timeline = [
    { label: 'Created', value: investigation.createdAt },
    { label: 'Started', value: investigation.startedAt },
    { label: 'Completed', value: investigation.completedAt },
  ];

  return (
    <main className="space-y-6">
      <Link href="/investigations" className={`text-sm ${linkClass}`}>
        ← Investigations
      </Link>

      <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="helix-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--glow), transparent)' }}
        />
        <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusPill status={investigation.status as InvestigationStatus} />
              {autonomous && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-primary)]">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  </svg>
                  autonomous{investigation.monitor?.name ? `, ${investigation.monitor.name}` : ''}
                </span>
              )}
              <span className="text-xs text-[var(--text-muted)]">{formatTriggerType(investigation.triggerType)}</span>
              {active && <AutoRefresh intervalMs={2000} />}
            </div>
            <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">{investigation.question}</h1>
            <p className="mt-2 break-all font-mono text-[11px] text-[var(--text-muted)]">{investigation.id}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {canPlay && <PlayRunButton href={playHref} active={theaterOpen} />}
              {active && !isDemoMode() && <CancelInvestigationButton id={investigation.id} />}
            </div>
          </div>
          {investigation.overallConfidence != null && (
            <div className="flex items-center gap-4 lg:flex-col lg:items-end">
              <ConfidenceRing value={investigation.overallConfidence} size={116} stroke={8} />
            </div>
          )}
        </div>

        <div className="relative grid grid-cols-2 border-t border-[var(--border)] sm:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`px-5 py-4 sm:px-7 ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''} border-[var(--border)]`}
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{s.value}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{s.hint}</p>
            </div>
          ))}
        </div>

        <ol className="relative flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-3 text-xs sm:px-7">
          {timeline.map((step, i) => (
            <li key={step.label} className="flex items-center gap-3">
              {i > 0 && <span className="h-px w-6 bg-[var(--border-strong)] sm:w-10" aria-hidden />}
              <span className={`h-2 w-2 rounded-full ${step.value ? 'bg-[var(--accent)]' : 'border border-[var(--border-strong)]'}`} aria-hidden />
              <span className="text-[var(--text-muted)]">{step.label}</span>
              <span className="tabular-nums text-[var(--text-primary)]">{formatDate(step.value)}</span>
            </li>
          ))}
        </ol>
      </header>

      {theaterOpen &&
        (canPlay ? (
          <RunTheater key={investigation.id} trace={trace} investigationId={investigation.id} />
        ) : (
          <TraceUnavailable active={active} />
        ))}

      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Investigation views">
        <ul className="flex min-w-max gap-1 border-b border-[var(--border)]">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={tabHref(t.key)}
                aria-current={current === t.key ? 'page' : undefined}
                scroll={false}
                className={`-mb-px inline-block border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
                  current === t.key
                    ? 'border-[var(--text-primary)] font-medium text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {current === 'overview' && <OverviewTab investigation={investigation} trace={trace} />}
      {current !== 'overview' && !trace && <TraceUnavailable active={active} />}
      {current === 'replay' && trace && <ReplayPlayer steps={buildReplaySteps(trace)} />}
      {current === 'graph' && trace && <GraphTab trace={trace} />}
      {current === 'trace' && trace && <TraceTab trace={trace} />}
    </main>
  );
}

function GraphTab({ trace }: { trace: InvestigationTrace }) {
  const data = buildGraphData(trace);
  if (data.nodes.length <= 1) {
    return (
      <Panel>
        <EmptyState title="Nothing to graph yet">Evidence and findings appear here once agents report back.</EmptyState>
      </Panel>
    );
  }
  return <EvidenceGraph data={data} />;
}

function TraceUnavailable({ active }: { active: boolean }) {
  return (
    <Panel>
      <EmptyState title="Trace unavailable">
        {isDemoMode()
          ? 'Replay, the evidence graph and the agent trace are not available in demo mode.'
          : active
            ? 'The trace fills in as agents report back. This page refreshes automatically.'
            : 'Could not load the trace for this investigation. Check that the API is running and up to date.'}
      </EmptyState>
    </Panel>
  );
}
