import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import {
  getAgents,
  getAnomalies,
  getApiHealth,
  getDashboardSummary,
  getDataSources,
  getInvestigation,
  getInvestigationTrace,
  getInvestigations,
  getMe,
  getMonitors,
  getOverview,
  getRecentAnomalies,
  getRevenue,
  getThroughput,
} from '../../lib/api';
import { countActive, formatDuration, formatTriggerType } from '../../lib/investigations';
import { anomalyMetricName, autonomousInvestigations, summarizeMonitors } from '../../lib/monitoring';
import { formatDelta, formatRelative, formatUtcDay } from '../../lib/format';
import { culpritChange, readCulprit } from '../../lib/trace';
import { Panel, SeverityBadge } from '../../components/panel';
import { AnomalyHeatmap, SegmentBars, ThroughputChart } from '../../components/charts';
import { RevenueChart } from '../../components/revenue-chart';
import { EmptyState, buttonClass, linkClass } from '../../components/ui';
import { LiveDot, Reveal, Stagger } from '../../components/motion';
import { DashboardHero, type HeroInvestigation } from '../../components/dashboard/hero';
import { KpiCard } from '../../components/dashboard/kpi-card';
import { DropBreakdown } from '../../components/dashboard/drop-breakdown';
import { AgentFleet } from '../../components/dashboard/agent-fleet';
import { ChannelMix } from '../../components/dashboard/channel-mix';
import { storyBecause, storyWhy } from '../../components/dashboard/story';

const DONE = new Set(['COMPLETED', 'PARTIALLY_COMPLETED']);

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
  const story = revenue?.story ?? null;

  const byNewest = [...investigations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const recent = byNewest.slice(0, 6);

  // Latest finished investigation with a root cause; prefer one about the story day.
  const solved = byNewest.filter((i) => DONE.has(i.status) && i.rootCauseFindingId);
  const aboutStory = story
    ? solved.find((i) => `${i.question} ${i.summary ?? ''}`.includes(story.date))
    : undefined;
  const pick = aboutStory ?? solved[0] ?? null;
  // The trace carries the culprit ("Caused by carla.m"); fail soft so the hero never waits on it.
  const [detail, heroTrace] = pick
    ? await Promise.all([getInvestigation(pick.id), getInvestigationTrace(pick.id).catch(() => null)])
    : [null, null];
  const culprit = (() => {
    try {
      return heroTrace ? readCulprit(heroTrace) : null;
    } catch {
      return null;
    }
  })();
  const heroInvestigation: HeroInvestigation | null =
    pick && detail
      ? {
          id: pick.id,
          question: pick.question,
          confidence: pick.overallConfidence ?? null,
          why: storyWhy(detail),
          because: storyBecause(detail),
          duration: formatDuration(pick.startedAt, pick.completedAt),
          culprit:
            culprit && culprit.author
              ? { handle: culprit.author, change: culpritChange(culprit), firstStep: culprit.fixPlan?.steps[0]?.title ?? null }
              : null,
        }
      : null;

  const connected = health?.status === 'ok';
  const activeCount = summary?.activeInvestigations ?? countActive(investigations);
  const connectedSources =
    summary?.connectedDataSources ?? sources?.filter((s) => s.status === 'CONNECTED').length ?? 0;
  const firstName = me?.user.name.split(/\s+/)[0];
  const needsSource = summary != null && summary.dataSources === 0;
  const needsQuestion = summary != null && summary.totalInvestigations === 0;
  const seriesEnd = revenue?.source?.seriesEnd ?? overview?.source?.seriesEnd ?? null;
  const flaggedDays = revenue?.series.filter((p) => p.isAnomaly).length ?? 0;

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span
          className={`inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium ${
            connected ? 'text-[var(--text-secondary)]' : 'text-[var(--text-bad)]'
          }`}
        >
          <LiveDot tone={connected ? 'good' : 'bad'} />
          {connected ? 'API connected' : 'API unreachable'}
        </span>
        <Link href="/investigations#new" className={buttonClass('primary')}>
          + New investigation
        </Link>
      </div>

      <DashboardHero
        firstName={firstName}
        story={story}
        investigation={heroInvestigation}
        sourceName={revenue?.source?.dataSourceName ?? null}
        seriesEnd={seriesEnd}
        stats={[
          { label: 'Investigations', value: summary?.totalInvestigations ?? investigations.length },
          { label: 'Running now', value: activeCount },
          { label: 'Anomalies', value: anomalies?.items.length ?? 0 },
        ]}
      />

      {(needsSource || needsQuestion) && (
        <Panel title="Get started" subtitle="Two steps to your first autonomous investigation">
          <ol className="grid gap-3 sm:grid-cols-2">
            <li className="rounded-xl border border-[var(--border)] p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Step 1 {needsSource ? '' : '· done'}</p>
              <p className="mt-1 text-sm font-medium">Connect a data source</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Point HELIX at a Postgres database, a CSV, an MCP server or a GitHub repository. Agents only read what you connect.
              </p>
              <Link href="/data-sources/new" className={`mt-3 ${buttonClass(needsSource ? 'primary' : 'secondary')}`}>
                Connect a data source
              </Link>
            </li>
            <li className="rounded-xl border border-[var(--border)] p-4">
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

      {!overview && !revenue && !anomalies && (
        <Panel title="Metrics and anomalies" subtitle="Revenue, expected band, anomaly heatmap">
          <EmptyState title="No metrics yet" action={{ href: '/data-sources/new', label: 'Connect a data source' }}>
            Connect a CSV or Postgres table with a date and an amount column (an orders table works best) and HELIX
            charts revenue, orders and refunds here, with anomalies flagged.
          </EmptyState>
        </Panel>
      )}

      {overview && overview.kpis.length > 0 && (
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" step={0.08}>
          {overview.kpis.map((k, i) => (
            <KpiCard
              key={k.key}
              kpi={k}
              index={i}
              caption={
                overview.window
                  ? `${formatUtcDay(overview.window.currentStart).replace(/, \d{4}$/, '')} to ${formatUtcDay(overview.window.currentEnd).replace(/, \d{4}$/, '')}, vs the 30 days before`
                  : undefined
              }
            />
          ))}
        </Stagger>
      )}

      {revenue && revenue.series.length > 1 && (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Reveal className={story && story.slices.length ? 'xl:col-span-2' : 'xl:col-span-3'}>
            <Panel
              className="h-full"
              title="Revenue vs expected"
              subtitle={`Daily, ${revenue.series.length} days${flaggedDays ? `, ${flaggedDays} day${flaggedDays === 1 ? '' : 's'} flagged` : ''}. Grey band: the range the anomaly detector treats as normal.`}
              action={
                revenue.projectionMape != null ? (
                  <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                    14-day forecast, backtest error {revenue.projectionMape.toFixed(1)}%
                  </span>
                ) : undefined
              }
            >
              <RevenueChart data={revenue.series} projection={revenue.projection} highlightDate={story?.date ?? null}
                highlightDeltaPercent={story?.deltaPercent ?? null}
              />
            </Panel>
          </Reveal>
          {story && story.slices.length > 0 && (
            <Reveal delay={0.1}>
              <Panel
                className="h-full"
                title={`Where it broke on ${story.weekday}`}
                subtitle={`${formatUtcDay(story.date)}: each ${story.dimension ?? 'slice'} against a normal ${story.weekday}`}
              >
                <DropBreakdown story={story} />
              </Panel>
            </Reveal>
          )}
        </section>
      )}

      {anomalies && (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Reveal className="xl:col-span-2">
            <Panel
              className="h-full"
              title="Anomaly heatmap"
              subtitle={`How unusual each day was, by metric, last ${anomalies.heatmap.days.length} days`}
            >
              {anomalies.heatmap.metrics.length ? (
                <AnomalyHeatmap {...anomalies.heatmap} threshold={anomalies.threshold ?? 3} highlightDay={story?.date ?? null} />
              ) : (
                <EmptyState title="Nothing scored yet">Anomaly scores appear once the data has enough history.</EmptyState>
              )}
            </Panel>
          </Reveal>
          <Reveal delay={0.1}>
            <Panel
              className="h-full"
              title="Flagged anomalies"
              action={<span className="text-xs tabular-nums text-[var(--text-muted)]">{anomalies.items.length} flagged</span>}
            >
              {anomalies.items.length === 0 ? (
                <EmptyState title="All quiet">No metric moved outside its normal range.</EmptyState>
              ) : (
                <Stagger as="ul" className="-my-2 max-h-[300px] divide-y divide-[var(--grid)] overflow-y-auto pr-1" step={0.05}>
                  {anomalies.items.slice(0, 10).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.metric}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                          <SeverityBadge severity={a.severity} /> · <span className="truncate">{a.segment}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            a.severity === 'critical' || a.change < 0 ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {formatDelta(a.change)}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">{formatUtcDay(a.date ?? a.detectedAt)}</p>
                      </div>
                    </div>
                  ))}
                </Stagger>
              )}
            </Panel>
          </Reveal>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {throughput && (
          <Reveal>
            <Panel className="h-full" title="Investigations per day" subtitle="Last 14 days, by what started them">
              <ThroughputChart data={throughput} />
            </Panel>
          </Reveal>
        )}
        {revenue && revenue.bySegment.length > 0 && (
          <Reveal delay={0.08}>
            <Panel
              className="h-full"
              title={`Revenue by ${revenue.segmentColumn ?? 'segment'}`}
              subtitle="Last 30 days vs the 30 days before"
            >
              {revenue.channelMix.length > 0 && (
                <div className="mb-6">
                  <ChannelMix data={revenue.channelMix} />
                </div>
              )}
              <SegmentBars data={revenue.bySegment} />
            </Panel>
          </Reveal>
        )}
        {agents && (
          <Reveal delay={0.16}>
            <Panel
              className="h-full"
              title="Agent fleet"
              subtitle={agents.length ? `${agents.length} agents, ${agents.filter((a) => a.status === 'BUSY').length} busy` : undefined}
              action={
                <Link href="/agents" className={`text-xs font-medium ${linkClass}`}>
                  Registry →
                </Link>
              }
            >
              {agents.length === 0 ? (
                <EmptyState title="No agents registered">The agent runtime has not reported any agents yet.</EmptyState>
              ) : (
                <AgentFleet agents={agents} />
              )}
            </Panel>
          </Reveal>
        )}
      </section>

      {monitoring && (
        <Reveal>
          <Panel
            title="Autonomous monitoring"
            subtitle="Monitors watch your metrics and open investigations on their own"
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
              <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <div>
                  <dt className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <LiveDot tone={monitoring.enabled > 0 ? 'good' : 'accent'} /> Watching
                  </dt>
                  <dd className="mt-2 text-3xl font-semibold tabular-nums">
                    {monitoring.enabled}
                    <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">of {monitoring.total} monitors</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-secondary)]">Last sweep</dt>
                  <dd className="mt-2 text-lg font-medium">{formatRelative(monitoring.lastRunAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-secondary)]">Opened on their own</dt>
                  <dd className="mt-2 text-3xl font-semibold tabular-nums">{autonomousCount}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--text-secondary)]">Last anomaly caught</dt>
                  <dd className="mt-2 text-sm">
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
        </Reveal>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Reveal className="xl:col-span-2">
          <Panel className="h-full !p-0">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
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
              <Stagger as="ul" className="divide-y divide-[var(--grid)] border-t border-[var(--grid)]" step={0.06}>
                {recent.map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/investigations/${inv.id}`}
                    className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium group-hover:underline">{inv.question}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatTriggerType(inv.triggerType)} · {formatRelative(String(inv.createdAt))}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {inv.overallConfidence != null && (
                        <span className="hidden items-center gap-2 sm:inline-flex">
                          <span className="h-1 w-14 overflow-hidden rounded-full bg-[var(--grid)]">
                            <span
                              className="block h-full rounded-full bg-[var(--series-1)]"
                              style={{ width: `${Math.round(inv.overallConfidence * 100)}%` }}
                            />
                          </span>
                          <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                            {Math.round(inv.overallConfidence * 100)}%
                          </span>
                        </span>
                      )}
                      <StatusPill status={inv.status} />
                    </div>
                  </Link>
                ))}
              </Stagger>
            )}
          </Panel>
        </Reveal>
        {sources && (
          <Reveal delay={0.08}>
            <Panel
              className="h-full"
              title="Data sources"
              subtitle={
                sources.length
                  ? `${connectedSources} connected · ${sources.reduce((s, d) => s + d.tables, 0)} tables`
                  : undefined
              }
              action={
                <Link href="/data-sources" className={`text-xs font-medium ${linkClass}`}>
                  Manage →
                </Link>
              }
            >
              {sources.length === 0 ? (
                <EmptyState title="No data sources yet" action={{ href: '/data-sources/new', label: 'Connect a data source' }}>
                  Investigations run against the data you connect.
                </EmptyState>
              ) : (
                <Stagger as="ul" className="-my-2 divide-y divide-[var(--grid)]" step={0.06}>
                  {sources.map((s) => (
                    <div key={s.id ?? s.name} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] uppercase text-[var(--text-secondary)]"
                          aria-hidden
                        >
                          {s.type.slice(0, 3)}
                        </span>
                        <div className="min-w-0">
                          {s.id ? (
                            <Link href={`/data-sources/${s.id}`} className="block truncate font-mono text-[13px] hover:underline">
                              {s.name}
                            </Link>
                          ) : (
                            <p className="truncate font-mono text-[13px]">{s.name}</p>
                          )}
                          <p className="text-[11px] text-[var(--text-muted)]">
                            {s.type.replace('_', ' ').toLowerCase()} · {s.tables} table{s.tables === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        {s.status === 'CONNECTED' ? (
                          <LiveDot tone="good" />
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: s.status === 'ERROR' ? 'var(--status-critical)' : 'var(--text-muted)' }}
                          />
                        )}
                        {s.status === 'CONNECTED'
                          ? formatRelative(s.lastSyncedAt)
                          : s.status === 'ERROR'
                            ? 'Sync failed'
                            : s.status.toLowerCase()}
                      </span>
                    </div>
                  ))}
                </Stagger>
              )}
            </Panel>
          </Reveal>
        )}
      </section>
    </main>
  );
}
