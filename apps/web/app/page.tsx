import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import {
  getAgents,
  getAnomalies,
  getApiHealth,
  getDataSources,
  getInvestigations,
  getOverview,
  getRevenue,
  getThroughput,
  type Kpi,
} from '../lib/api';
import { countActive, formatTriggerType } from '../lib/investigations';
import { formatCurrency, formatDelta, formatPercent, formatRelative } from '../lib/format';
import { Panel, SeverityBadge } from '../components/panel';
import { AnomalyHeatmap, SegmentBars, Sparkline, ThroughputChart } from '../components/charts';
import { RevenueChart } from '../components/revenue-chart';

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
  const [health, investigations, overview, revenue, anomalies, throughput, agents, sources] =
    await Promise.all([
      getApiHealth(),
      getInvestigations(),
      getOverview(),
      getRevenue(),
      getAnomalies(),
      getThroughput(),
      getAgents(),
      getDataSources(),
    ]);

  const recent = [...investigations]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const headline = investigations.find((i) => i.summary && i.overallConfidence && i.overallConfidence > 0.9);
  const connected = health?.status === 'ok';

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Good morning — here&apos;s what changed</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {countActive(investigations)} investigations running · {anomalies?.items.length ?? 0} open anomalies ·{' '}
            {sources?.filter((s) => s.status === 'CONNECTED').length ?? 0} data sources synced
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
          <span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
            Last 90 days ▾
          </span>
          <button className="rounded-lg bg-[#0b0b0b] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#2b2b2b]">
            + New investigation
          </button>
        </div>
      </header>

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
                ['5', 'agents'],
                ['14', 'evidence items'],
                ['23 min', 'to answer'],
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
                    <p className="text-[11px] text-[var(--text-muted)]">{formatRelative(a.detectedAt)}</p>
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
        {agents && (
          <Panel title="Agent fleet" subtitle="Tasks handled this month">
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
                    <td className="py-2 text-right tabular-nums">{formatPercent(a.successRate, 0)}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{(a.avgMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2 !p-0"
          title=""
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold">Recent investigations</h2>
            <Link href="/investigations" className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">No investigations yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/investigations/${inv.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--canvas)]">
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
        {sources && (
          <Panel title="Data sources" subtitle={`${sources.reduce((s, d) => s + d.tables, 0)} tables profiled`}>
            <ul className="-my-2 divide-y divide-[var(--grid)]">
              {sources.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px]">{s.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {s.type.replace('_', ' ').toLowerCase()} · {s.tables} tables
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span aria-hidden style={{ color: s.status === 'CONNECTED' ? 'var(--status-good)' : 'var(--status-critical)' }}>
                      {s.status === 'CONNECTED' ? '✓' : '✕'}
                    </span>
                    {s.status === 'CONNECTED' ? formatRelative(s.lastSyncedAt) : 'Sync failed'}
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
