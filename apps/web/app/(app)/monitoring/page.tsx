import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import {
  getInvestigations,
  getMonitorSeries,
  getMonitorSuggestions,
  getMonitors,
  getProjects,
  getRecentAnomalies,
  isDemoMode,
} from '../../../lib/api';
import { autonomousInvestigations, describeAggregation, suggestionKey, summarizeMonitors } from '../../../lib/monitoring';
import { formatDate } from '../../../lib/investigations';
import { formatRelative } from '../../../lib/format';
import { Panel } from '../../../components/panel';
import { CountUp, LiveDot, Reveal, Stagger } from '../../../components/motion';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
import { AddSuggestionForm, RunAllMonitorsButton } from './monitor-actions';
import { MonitorCard } from './monitor-card';
import { MonitorLiveProvider, PipelineStrip } from './monitoring-live';
import { AnomalyTimeline } from './anomaly-timeline';

export const metadata = { title: 'Monitoring · HELIX' };

export default async function MonitoringPage() {
  const demo = isDemoMode();
  const [monitors, suggestions, anomalies, investigations, projects] = await Promise.all([
    getMonitors(),
    getMonitorSuggestions(),
    getRecentAnomalies(50),
    getInvestigations(),
    getProjects(),
  ]);
  const allAutonomous = autonomousInvestigations(investigations);
  const autonomous = allAutonomous.slice(0, 10);
  const summary = monitors ? summarizeMonitors(monitors) : null;
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, name: p.name }));
  // The watched series per monitor (read-only engine call), for the radar cards.
  const series = monitors ? await Promise.all(monitors.map((m) => getMonitorSeries(m.id))) : [];
  const flagged = series.filter((x) => x?.picked).length;
  const featured = monitors?.find((m) => m.enabled) ?? monitors?.[0] ?? null;

  const stats = summary
    ? [
        { label: 'Monitors watching', value: summary.enabled, detail: `of ${summary.total} total`, live: summary.enabled > 0 },
        { label: 'Anomalies in watch window', value: flagged, detail: 'right now, per the engine', bad: flagged > 0 },
        { label: 'Autonomous investigations', value: allAutonomous.length, detail: 'opened by monitors, no human' },
      ]
    : [];

  return (
    <MonitorLiveProvider>
      <main className="space-y-6">
        <PageHeader
          eyebrow="Monitoring"
          title={
            <span className="inline-flex items-center gap-3">
              Autonomous monitoring
              {summary && summary.enabled > 0 && <LiveDot tone="accent" className="mt-1" />}
            </span>
          }
          description="HELIX watches your metrics around the clock. When one breaks, it opens an investigation by itself and tells your team why."
          actions={monitors && monitors.length > 0 ? <RunAllMonitorsButton disabled={summary?.enabled === 0} /> : undefined}
        />

        {demo && <Notice tone="info">Monitoring is not available in demo mode.</Notice>}

        {!demo && (
          <Reveal>
            <PipelineStrip idleStatus={featured?.lastStatus ?? null} idleName={featured?.name ?? null} />
          </Reveal>
        )}

        {summary && (
          <Stagger as="section" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <Panel key={s.label} className="!p-5">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                  {s.live && <LiveDot tone="good" />}
                  {s.label}
                </p>
                <p className={`mt-3 text-4xl font-semibold leading-none tracking-tight ${s.bad ? 'text-[var(--text-bad)]' : ''}`}>
                  <CountUp value={s.value} />
                </p>
                <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{s.detail}</p>
              </Panel>
            ))}
            <Panel className="!p-5">
              <p className="text-xs font-medium text-[var(--text-secondary)]">Last run</p>
              <p className="mt-3 text-4xl font-semibold leading-none tracking-tight">{formatRelative(summary.lastRunAt)}</p>
              <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{summary.lastRunAt ? formatDate(summary.lastRunAt) : 'not run yet'}</p>
            </Panel>
          </Stagger>
        )}

        {!demo && (
          <section aria-label="Monitors" className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Monitors</h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">Each one sweeps its metric on a schedule. Press Run now to watch a sweep live.</p>
              </div>
            </div>
            {monitors === null ? (
              <Notice tone="error">Could not load monitors. Check that the API is running.</Notice>
            ) : monitors.length === 0 ? (
              <Panel>
                <EmptyState title="No monitors yet">
                  Add one of the suggested monitors below. HELIX suggests revenue, orders, refunds and active customers for
                  every connected table with a date column.
                </EmptyState>
              </Panel>
            ) : (
              <Stagger className={`grid gap-4 ${monitors.length > 1 ? '2xl:grid-cols-2' : ''}`} step={0.08}>
                {monitors.map((m, i) => (
                  <MonitorCard key={m.id} monitor={m} series={series[i] ?? null} sound={i === 0} />
                ))}
              </Stagger>
            )}
          </section>
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

        <div className="grid gap-4 xl:grid-cols-5">
          <Panel title="Anomaly timeline" subtitle="Every anomaly HELIX has recorded, by day" className="xl:col-span-3">
            {anomalies === null ? (
              <p className="pb-3 text-sm text-[var(--text-muted)]">{demo ? 'Not available in demo mode.' : 'Could not load anomalies.'}</p>
            ) : anomalies.length === 0 ? (
              <EmptyState title="No anomalies recorded">Anomalies appear once a monitor or investigation finds one.</EmptyState>
            ) : (
              <AnomalyTimeline anomalies={anomalies} />
            )}
          </Panel>

          <Panel title="Opened by monitors" subtitle="Autonomous investigations, newest first" className="!pb-2 xl:col-span-2">
            {autonomous.length === 0 ? (
              <EmptyState title="None yet">When a monitor finds a severe anomaly it opens an investigation here.</EmptyState>
            ) : (
              <Stagger as="ul" className="-mx-5 divide-y divide-[var(--grid)] border-t border-[var(--grid)]">
                {autonomous.map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/investigations/${inv.id}`}
                    className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium">{inv.question}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{formatRelative(String(inv.createdAt))}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusPill status={inv.status} />
                      <span aria-hidden className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5">
                        →
                      </span>
                    </span>
                  </Link>
                ))}
              </Stagger>
            )}
          </Panel>
        </div>
      </main>
    </MonitorLiveProvider>
  );
}
