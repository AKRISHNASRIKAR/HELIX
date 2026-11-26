import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import {
  getAgents,
  getAnomalies,
  getApiHealth,
  getDashboardSummary,
  getDataSources,
  getMe,
  getInvestigations,
  getMonitors,
  getOverview,
  getRecentAnomalies,
  getRevenue,
  getThroughput,
  type Kpi,
} from '../../lib/api';
import { countActive, formatDuration, formatTriggerType } from '../../lib/investigations';
import { anomalyMetricName, autonomousInvestigations, summarizeMonitors } from '../../lib/monitoring';
import { formatCurrency, formatDelta, formatPercent, formatRelative, formatUtcDay } from '../../lib/format';
import { Panel, SeverityBadge } from '../../components/panel';
import { AnomalyHeatmap, SegmentBars, Sparkline, ThroughputChart } from '../../components/charts';
import { RevenueChart } from '../../components/revenue-chart';
import { EmptyState, buttonClass, linkClass } from '../../components/ui';

function formatKpi(k: Kpi) {
  switch (k.unit) {
    case 'currency':
      return formatCurrency(k.value);
    case 'percent':
      return formatPercent(k.value, 2);
    case 'minutes':
      return `${k.value} min`;
    default:
      return String(k.value);
  }
}

/** For counts of problems and durations, going down is good. */
const LOWER_IS_BETTER = new Set(['anomalies', 'mttr']);

export default async function DashboardPage() {
  const [
    health,
    investigations,
    overview,
    revenue,
    anomalies,
    throughput,
    agents,
    sources,
    summary,
    me,
    monitors,
    recentAnomalies,
  ] = await Promise.all([
      getApiHealth(),
      getInvestigations(),
      getOverview(),
      getRevenue(),
      getAnomalies(),
      getThroughput(),
      getAgents(),
      getDataSources(),
      getDashboardSummary(),
      getMe(),
      getMonitors(),
      getRecentAnomalies(5),
    ]);
  const monitoring = monitors ? summarizeMonitors(monitors) : null;
  const lastAnomaly = recentAnomalies?.[0] ?? null;
  const autonomousCount = autonomousInvestigations(investigations).length;

  const recent = [...investigations]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const headline = investigations.find((i) => i.summary && i.overallConfidence && i.overallConfidence > 0.9);
  const connected = health?.status === 'ok';

  // Real counts come from /dashboard/summary; demo mode has no such endpoint,
  // so derive them from the lists like before.
  const activeCount = summary?.activeInvestigations ?? countActive(investigations);
  const connectedSources =
    summary?.connectedDataSources ?? sources?.filter((s) => s.status === 'CONNECTED').length ?? 0;
  const firstName = me?.user.name.split(/\s+/)[0];
  const needsSource = summary != null && summary.dataSources === 0;
  const needsQuestion = summary != null && summary.totalInvestigations === 0;
  const headlineDuration = headline ? formatDuration(headline.startedAt, headline.completedAt) : null;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {firstName ? `Welcome back, ${firstName}` : 'Here\'s what changed'}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {activeCount} investigation{activeCount === 1 ? '' : 's'} running
            {anomalies && ` · ${anomalies.items.length} open anomalies`} · {connectedSources} data source
            {connectedSources === 1 ? '' : 's'} connected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium ${
              connected ? 'text-[var(--text-secondary)]' : 'text-[var(--text-bad)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-[var(--status-good)]' : 'bg-[var(--status-critical)]'}`} />
            {connected ? 'API connected' : 'API unreachable'}
          </span>
          {revenue && (
            <span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
              Last 90 days
            </span>
          )}
          <Link href="/investigations#new" className={buttonClass('primary')}>
            + New investigation
          </Link>
        </div>
      </header>

      {summary && (
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Workspace summary">
          {[
            { label: 'Active investigations', value: summary.activeInvestigations, href: '/investigations' },
            { label: 'Total investigations', value: summary.totalInvestigations, href: '/investigations' },
            {
              label: 'Data sources',
              value: summary.dataSources,
              detail: `${summary.connectedDataSources} connected`,
              href: '/data-sources',
            },
            { label: 'Projects', value: summary.projects, href: '/settings' },
          ].map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]"
            >
              <Panel className="!p-4 transition-colors hover:border-[#d4d3cd]">
                <p className="text-xs font-medium text-[var(--text-secondary)]">{stat.label}</p>
                <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{stat.value}</p>
                {stat.detail && <p className="mt-2 text-xs text-[var(--text-muted)]">{stat.detail}</p>}
              </Panel>
            </Link>
          ))}
        </section>
      )}

      {(needsSource || needsQuestion) && (
        <Panel title="Get started" subtitle="Two steps to your first autonomous investigation">
          <ol className="grid gap-3 sm:grid-cols-2">
            <li className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Step 1 {needsSource ? '' : '· done'}</p>
              <p className="mt-1 text-sm font-medium">Connect a data source</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Point HELIX at a Postgres database, a CSV, an MCP server or a GitHub repository. Agents only read what you connect.
              </p>
              <Link href="/data-sources/new" className={`mt-3 ${buttonClass(needsSource ? 'primary' : 'secondary')}`}>
                Connect a data source
              </Link>
            </li>
            <li className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Step 2</p>
              <p className="mt-1 text-sm font-medium">Ask a question</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                For example: &ldquo;Why did revenue drop last week?&rdquo; The Coordinator plans and runs the analysis.
              </p>
              <Link href="/investigations#new" className={`mt-3 ${buttonClass(needsSource ? 'secondary' : 'primary')}`}>
                Ask a question
              </Link>
            </li>
          </ol>
        </Panel>
      )}

      {!overview && !revenue && !anomalies && !throughput && (
        <Panel title="Metrics and anomalies" subtitle="Revenue trends, forecasts and anomaly heatmaps">
          <EmptyState title="No metric dashboards yet">
            Metrics, anomalies and forecasts computed during investigations are shown on each
            investigation&apos;s page. Workspace-wide charts will appear here once scheduled analytics are enabled.
          </EmptyState>
        </Panel>
      )}

      {overview && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview.kpis.map((k) => {
            const good = LOWER_IS_BETTER.has(k.key) ? k.delta < 0 : k.delta > 0;
            return (
              <Panel key={k.key} className="!p-4">
                <p className="text-xs font-medium text-[var(--text-secondary)]">{k.label}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">{formatKpi(k)}</p>
                    <p className={`mt-2 text-xs font-medium ${good ? 'text-[var(--text-good)]' : 'text-[var(--text-bad)]'}`}>
                      {k.delta > 0 ? '▲' : '▼'} {formatDelta(k.delta)}
                      <span className="font-normal text-[var(--text-muted)]"> vs prior period</span>
                    </p>
                  </div>
                  <Sparkline values={k.spark} tone={good ? 'good' : 'bad'} />
                </div>
              </Panel>
            );
          })}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {revenue && (
          <Panel
            className="xl:col-span-2"
            title="Revenue vs forecast"
            subtitle="Daily, last 90 days · forecast from the analytics engine (Prophet, MAPE 2.9%)"
          >
            <RevenueChart data={revenue.series} />
          </Panel>
        )}
        {headline && (
          <Panel title="Latest root cause" subtitle="Found autonomously by the Coordinator">
            <Link href={`/investigations/${headline.id}`} className="group block">
              <p className="text-sm font-medium leading-snug group-hover:underline">{headline.question}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--grid)]">
                  <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${headline.overallConfidence! * 100}%` }} />
                </div>
                <span className="text-xs font-semibold tabular-nums">{Math.round(headline.overallConfidence! * 100)}% confidence</span>
              </div>
              <p className="mt-3 line-clamp-6 text-[13px] leading-relaxed text-[var(--text-secondary)]">{headline.summary}</p>
            </Link>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4 text-center">
              {[
                [formatTriggerType(headline.triggerType), 'trigger'],
                [`${Math.round(headline.overallConfidence! * 100)}%`, 'confidence'],
                [headlineDuration ?? '-', 'to answer'],
              ].map(([v, l]) => (
                <div key={l}>
                  <p className="text-sm font-semibold">{v}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{l}</p>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {anomalies && (
          <Panel className="xl:col-span-2" title="Anomaly intensity" subtitle="Absolute z-score by metric, last 14 days">
            <AnomalyHeatmap {...anomalies.heatmap} />
          </Panel>
        )}
        {anomalies && (
          <Panel title="Open anomalies" action={<span className="text-xs text-[var(--text-muted)]">{anomalies.items.length} open</span>}>
            <ul className="-my-2 divide-y divide-[var(--grid)]">
              {anomalies.items.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.metric}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <SeverityBadge severity={a.severity} /> · {a.segment}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold tabular-nums ${a.change < 0 ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'}`}>
                      {formatDelta(a.change)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">{formatUtcDay(a.detectedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {throughput && (
          <Panel title="Investigations per day" subtitle="Last 14 days, by trigger">
            <ThroughputChart data={throughput} />
          </Panel>
        )}
        {revenue && (
          <Panel title="Revenue by segment" subtitle="Quarter to date vs last quarter">
            <SegmentBars data={revenue.bySegment} />
          </Panel>
        )}
        {agents && agents.length === 0 && (
          <Panel title="Agent fleet">
            <EmptyState title="No agents registered">The agent runtime has not reported any agents yet.</EmptyState>
          </Panel>
        )}
        {agents && agents.length > 0 && (
          <Panel
            title="Agent fleet"
            subtitle={`${agents.length} agents · tasks handled for this organization`}
            action={
              <Link href="/agents" className={`text-xs font-medium ${linkClass}`}>
                Registry →
              </Link>
            }
          >
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 text-right font-medium">Tasks</th>
                  <th className="pb-2 text-right font-medium">Success</th>
                  <th className="pb-2 text-right font-medium">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--grid)]">
                {agents.map((a) => (
                  <tr key={a.type}>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${a.status === 'BUSY' ? 'bg-[var(--series-1)]' : 'bg-[var(--text-muted)]'}`}
                          title={a.status}
                        />
                        <span className="font-medium">{a.name}</span>
                        <span className="text-[11px] text-[var(--text-muted)]">{a.status.toLowerCase()}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{a.tasks}</td>
                    <td className="py-2 text-right tabular-nums">
                      {a.successRate == null ? '-' : formatPercent(a.successRate, 0)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {a.avgMs == null ? '-' : `${(a.avgMs / 1000).toFixed(1)}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </section>

      {monitoring && (
        <Panel
          title="Monitoring"
          subtitle="Autonomous anomaly monitors"
          action={
            <Link href="/monitoring" className={`text-xs font-medium ${linkClass}`}>
              Manage →
            </Link>
          }
        >
          {monitoring.total === 0 ? (
            <EmptyState title="No monitors yet" action={{ href: '/monitoring', label: 'Add a monitor' }}>
              Monitors watch revenue, orders or refunds and open an investigation on their own when something breaks.
            </EmptyState>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">Monitors</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {monitoring.total}
                  <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">{monitoring.enabled} enabled</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">Last run</dt>
                <dd className="mt-1 text-sm font-medium">{formatRelative(monitoring.lastRunAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">Autonomous investigations</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{autonomousCount}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-[var(--text-secondary)]">Last anomaly</dt>
                <dd className="mt-1 text-sm">
                  {lastAnomaly ? (
                    <>
                      <span className="block truncate font-medium" title={lastAnomaly.description}>
                        {anomalyMetricName(lastAnomaly)}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {lastAnomaly.severity.toString().toLowerCase()} · {formatUtcDay(lastAnomaly.detectedAt)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">none recorded</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </Panel>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2 !p-0">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold">Recent investigations</h2>
            <Link href="/investigations" className={`text-xs font-medium ${linkClass}`}>
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState title="No investigations yet" action={{ href: '/investigations#new', label: 'Ask a question' }}>
              Ask HELIX why a metric moved and watch the agents work through it.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/investigations/${inv.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--canvas)] focus-visible:bg-[var(--canvas)] focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{inv.question}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatTriggerType(inv.triggerType)} · {formatRelative(String(inv.createdAt))}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {inv.overallConfidence != null && (
                        <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                          {Math.round(inv.overallConfidence * 100)}%
                        </span>
                      )}
                      <StatusPill status={inv.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {sources && sources.length === 0 && (
          <Panel title="Data sources">
            <EmptyState title="No data sources yet" action={{ href: '/data-sources/new', label: 'Connect a data source' }}>
              Investigations run against the data you connect.
            </EmptyState>
          </Panel>
        )}
        {sources && sources.length > 0 && (
          <Panel
            title="Data sources"
            subtitle={`${sources.reduce((s, d) => s + d.tables, 0)} tables discovered`}
            action={
              <Link href="/data-sources" className={`text-xs font-medium ${linkClass}`}>
                Manage →
              </Link>
            }
          >
            <ul className="-my-2 divide-y divide-[var(--grid)]">
              {sources.map((s) => (
                <li key={s.id ?? s.name} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    {s.id ? (
                      <Link href={`/data-sources/${s.id}`} className="block truncate font-mono text-[13px] hover:underline">
                        {s.name}
                      </Link>
                    ) : (
                      <p className="truncate font-mono text-[13px]">{s.name}</p>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {s.type.replace('_', ' ').toLowerCase()} · {s.tables} tables
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span
                      aria-hidden
                      style={{
                        color:
                          s.status === 'CONNECTED'
                            ? 'var(--status-good)'
                            : s.status === 'ERROR'
                              ? 'var(--status-critical)'
                              : 'var(--text-muted)',
                      }}
                    >
                      {s.status === 'CONNECTED' ? '✓' : s.status === 'ERROR' ? '✕' : '○'}
                    </span>
                    {s.status === 'CONNECTED'
                      ? formatRelative(s.lastSyncedAt)
                      : s.status === 'ERROR'
                        ? 'Sync failed'
                        : s.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </main>
  );
}
