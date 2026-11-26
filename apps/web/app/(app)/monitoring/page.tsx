import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import {
  getInvestigations,
  getMonitorSuggestions,
  getMonitors,
  getProjects,
  getRecentAnomalies,
  isDemoMode,
} from '../../../lib/api';
import {
  anomalyChange,
  anomalyMetricName,
  autonomousInvestigations,
  describeAggregation,
  monitorStatusLabel,
  monitorStatusTone,
  suggestionKey,
  summarizeMonitors,
  type MonitorTone,
} from '../../../lib/monitoring';
import { formatDate } from '../../../lib/investigations';
import { formatDelta, formatRelative, formatUtcDay } from '../../../lib/format';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader, linkClass } from '../../../components/ui';
import { AddSuggestionForm, MonitorRowActions, MonitorToggle, RunAllMonitorsButton } from './monitor-actions';

export const metadata = { title: 'Monitoring · HELIX' };

const TONE: Record<MonitorTone, { dot: string; text: string }> = {
  good: { dot: 'bg-[var(--status-good)]', text: 'text-[var(--text-good)]' },
  warn: { dot: 'bg-[var(--status-serious)]', text: 'text-[#9a3f18]' },
  bad: { dot: 'bg-[var(--status-critical)]', text: 'text-[var(--text-bad)]' },
  info: { dot: 'bg-[var(--series-1)]', text: 'text-[var(--text-secondary)]' },
  muted: { dot: 'bg-[var(--grid)]', text: 'text-[var(--text-muted)]' },
};

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-[#fbe4e4] text-[var(--text-bad)]',
  HIGH: 'bg-[#fdeee6] text-[#9a3f18]',
  MEDIUM: 'bg-[#fff6e0] text-[#7a5a00]',
  LOW: 'bg-[var(--canvas)] text-[var(--text-muted)]',
};

export default async function MonitoringPage() {
  const demo = isDemoMode();
  const [monitors, suggestions, anomalies, investigations, projects] = await Promise.all([
    getMonitors(),
    getMonitorSuggestions(),
    getRecentAnomalies(50),
    getInvestigations(),
    getProjects(),
  ]);
  const autonomous = autonomousInvestigations(investigations).slice(0, 10);
  const summary = monitors ? summarizeMonitors(monitors) : null;
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Autonomous monitoring"
        description="Monitors watch a metric on a schedule. When a severe anomaly appears, HELIX opens an investigation on its own and notifies your team."
        actions={monitors && monitors.length > 0 ? <RunAllMonitorsButton disabled={summary?.enabled === 0} /> : undefined}
      />

      {demo && <Notice tone="info">Monitoring is not available in demo mode.</Notice>}

      {summary && (
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Monitoring summary">
          {[
            { label: 'Monitors', value: String(summary.total), detail: `${summary.enabled} enabled` },
            { label: 'Flagging an anomaly', value: String(summary.withAnomaly), detail: 'as of their last run' },
            { label: 'Last run', value: formatRelative(summary.lastRunAt), detail: formatDate(summary.lastRunAt) },
            { label: 'Autonomous investigations', value: String(autonomousInvestigations(investigations).length), detail: 'opened by monitors' },
          ].map((s) => (
            <Panel key={s.label} className="!p-4">
              <p className="text-xs font-medium text-[var(--text-secondary)]">{s.label}</p>
              <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight tabular-nums">{s.value}</p>
              <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{s.detail}</p>
            </Panel>
          ))}
        </section>
      )}

      {!demo && (
        <Panel className="!p-0">
          <div className="px-5 pb-3 pt-5">
            <h2 className="text-sm font-semibold">Monitors</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Run on a schedule by the API, or on demand here</p>
          </div>
          {monitors === null ? (
            <div className="px-5 pb-5">
              <Notice tone="error">Could not load monitors. Check that the API is running.</Notice>
            </div>
          ) : monitors.length === 0 ? (
            <EmptyState title="No monitors yet">
              Add one of the suggested monitors below. HELIX suggests revenue, orders, refunds and active customers for
              every connected table with a date column.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-y border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Monitor</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Data source</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Metric</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Last run</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Enabled</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--grid)]">
                  {monitors.map((m) => {
                    const tone = TONE[monitorStatusTone(m.lastStatus)];
                    return (
                      <tr key={m.id} className="align-top">
                        <td className="px-5 py-3">
                          <p className="font-medium">{m.name}</p>
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                            min severity {m.minSeverity.toLowerCase()} · last {m.lookbackDays}d · cooldown {m.cooldownHours}h
                          </p>
                          {m.latestInvestigation && (
                            <Link href={`/investigations/${m.latestInvestigation.id}`} className={`mt-1 inline-block text-xs ${linkClass}`}>
                              Latest investigation ({m.investigationsCount ?? 1}) →
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {m.dataSource ? (
                            <Link href={`/data-sources/${m.dataSource.id}`} className={`font-mono text-[13px] ${linkClass}`}>
                              {m.dataSource.name}
                            </Link>
                          ) : (
                            <span className="font-mono text-[13px] text-[var(--text-muted)]">{m.dataSourceId.slice(0, 8)}</span>
                          )}
                          <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{m.tableName}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p>{m.metricKey}</p>
                          <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                            {describeAggregation(m)} by {m.timeColumn}
                          </p>
                        </td>
                        <td className="max-w-[260px] px-3 py-3">
                          <p className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                            {monitorStatusLabel(m.lastStatus)}
                          </p>
                          {m.lastMessage && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{m.lastMessage}</p>}
                          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]" title={formatDate(m.lastRunAt)}>
                            {m.lastRunAt ? formatRelative(m.lastRunAt) : 'never run'}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <MonitorToggle id={m.id} name={m.name} enabled={m.enabled} />
                        </td>
                        <td className="px-5 py-3">
                          <MonitorRowActions id={m.id} name={m.name} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {!demo && suggestions && suggestions.length > 0 && (
        <Panel title="Suggested monitors" subtitle="Detected from your connected data sources" className="!pb-2">
          {projectOptions.length === 0 ? (
            <Notice tone="info">
              Monitors belong to a project.{' '}
              <Link href="/settings#projects" className="underline">
                Create a project
              </Link>{' '}
              to add one.
            </Notice>
          ) : (
            <ul className="-mx-5 divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
              {suggestions.map((s) => {
                const key = suggestionKey(s);
                return (
                  <li key={key} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        <span className="font-mono">{describeAggregation(s)}</span> by{' '}
                        <span className="font-mono">{s.timeColumn}</span> in{' '}
                        <span className="font-mono">
                          {s.dataSourceName}.{s.tableName}
                        </span>
                        {s.filter ? ' (filtered)' : ''}
                      </p>
                    </div>
                    <AddSuggestionForm suggestion={s} projects={projectOptions} formId={key.replace(/[^a-zA-Z0-9]/g, '-')} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent anomalies" subtitle="Detected during investigations and monitor runs" className="!pb-2">
          {anomalies === null ? (
            <p className="pb-3 text-sm text-[var(--text-muted)]">{demo ? 'Not available in demo mode.' : 'Could not load anomalies.'}</p>
          ) : anomalies.length === 0 ? (
            <EmptyState title="No anomalies recorded">Anomalies appear once a monitor or investigation finds one.</EmptyState>
          ) : (
            <ul className="-mx-5 max-h-[480px] divide-y divide-[var(--grid)] overflow-y-auto border-t border-[var(--grid)]">
              {anomalies.map((a) => {
                const change = anomalyChange(a);
                return (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{anomalyMetricName(a)}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">{a.description}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${SEVERITY_STYLE[String(a.severity)] ?? SEVERITY_STYLE.LOW}`}>
                          {String(a.severity).toLowerCase()}
                        </span>
                        <time dateTime={a.detectedAt}>{formatUtcDay(a.detectedAt)}</time>
                        {a.investigationId && (
                          <Link href={`/investigations/${a.investigationId}`} className={linkClass}>
                            investigation →
                          </Link>
                        )}
                      </p>
                    </div>
                    {change != null && (
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${change < 0 ? 'text-[var(--text-bad)]' : ''}`}>
                        {formatDelta(change)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Autonomous investigations" subtitle="Opened by monitors, newest first" className="!pb-2">
          {autonomous.length === 0 ? (
            <EmptyState title="None yet">When a monitor finds a severe anomaly it opens an investigation here.</EmptyState>
          ) : (
            <ul className="-mx-5 divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
              {autonomous.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/investigations/${inv.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--canvas)] focus-visible:bg-[var(--canvas)] focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{inv.question}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{formatRelative(String(inv.createdAt))}</p>
                    </div>
                    <StatusPill status={inv.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}
