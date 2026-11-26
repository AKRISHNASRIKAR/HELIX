import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@helix/ui';
import { getInvestigation, getInvestigationTrace, isDemoMode, type InvestigationTrace } from '../../../../lib/api';
import { formatDate, formatDuration, formatTriggerType, isActiveStatus } from '../../../../lib/investigations';
import { buildGraphData, buildReplaySteps } from '../../../../lib/trace';
import { Panel } from '../../../../components/panel';
import { AutoRefresh } from '../../../../components/auto-refresh';
import { EmptyState, linkClass } from '../../../../components/ui';
import { CancelInvestigationButton } from './cancel-button';
import { OverviewTab } from './overview-tab';
import { ReplayPlayer } from './replay-player';
import { EvidenceGraph } from './evidence-graph';
import { TraceTab } from './trace-tab';

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
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [investigation, trace] = await Promise.all([getInvestigation(id), getInvestigationTrace(id)]);

  if (!investigation) notFound();

  const current: TabKey = TABS.find((t) => t.key === tab)?.key ?? 'overview';
  const active = isActiveStatus(investigation.status);
  const duration = formatDuration(investigation.startedAt, investigation.completedAt);

  const meta = [
    { label: 'Trigger', value: formatTriggerType(investigation.triggerType) },
    {
      label: 'Confidence',
      value: investigation.overallConfidence == null ? '-' : `${Math.round(investigation.overallConfidence * 100)}%`,
    },
    { label: 'Created', value: formatDate(investigation.createdAt) },
    { label: 'Started', value: formatDate(investigation.startedAt) },
    { label: 'Completed', value: formatDate(investigation.completedAt) },
    { label: 'Duration', value: duration ?? (active ? 'running' : '-') },
  ];

  return (
    <main className="space-y-6">
      <Link href="/investigations" className={`text-sm ${linkClass}`}>
        ← Investigations
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={investigation.status} />
            {String(investigation.triggerType) === 'ANOMALY_DETECTED' && (
              <span className="rounded-full bg-[#fdeee6] px-2.5 py-0.5 text-xs font-medium text-[#9a3f18]">autonomous</span>
            )}
            {active && <AutoRefresh intervalMs={2000} />}
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{investigation.question}</h1>
          <p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{investigation.id}</p>
        </div>
        {active && !isDemoMode() && <CancelInvestigationButton id={investigation.id} />}
      </header>

      <Panel>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {meta.map((item) => (
            <div key={item.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{item.label}</dt>
              <dd className="mt-1 text-sm">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Investigation views">
        <ul className="flex min-w-max gap-1 border-b border-[var(--border)]">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={t.key === 'overview' ? `/investigations/${investigation.id}` : `/investigations/${investigation.id}?tab=${t.key}`}
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
