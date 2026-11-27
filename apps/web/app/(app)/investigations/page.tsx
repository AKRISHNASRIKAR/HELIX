import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import { getInvestigations, getProjects, isDemoMode } from '../../../lib/api';
import { formatDate, formatTriggerType, isActive } from '../../../lib/investigations';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice } from '../../../components/ui';
import { NewInvestigationForm } from './new-investigation-form';

export const metadata = {
  title: 'Investigations · HELIX',
};

export default async function InvestigationsPage() {
  const [investigations, projects] = await Promise.all([getInvestigations(), getProjects()]);
  const demo = isDemoMode();
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const sorted = [...investigations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const running = sorted.filter(isActive).length;
  const autonomous = sorted.filter((i) => String(i.triggerType) === 'ANOMALY_DETECTED').length;

  return (
    <main className="space-y-8">
      <section
        id="new"
        className="helix-beam relative scroll-mt-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)] sm:p-8"
      >
        <div className="helix-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[70%] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--glow), transparent)' }}
        />
        <div className="relative">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Investigations</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Ask HELIX anything.</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)] sm:text-base">
            The Coordinator plans, specialist agents dig through your data in parallel, and you get one root cause with
            the evidence behind it.
          </p>
          <div className="mt-6">
            {demo ? (
              <Notice tone="info">Creating investigations is disabled in demo mode.</Notice>
            ) : projects === null ? (
              <Notice tone="error">Could not load projects, so a new investigation can&apos;t be started right now.</Notice>
            ) : projects.length === 0 ? (
              <EmptyState title="Create a project first" action={{ href: '/settings#projects', label: 'Create a project' }}>
                Investigations belong to a project. Create one, then come back to ask your question.
              </EmptyState>
            ) : (
              <NewInvestigationForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="history-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="history-title" className="text-lg font-semibold tracking-tight">
              Past runs
            </h2>
            <p className="text-xs text-[var(--text-muted)]">Open one to replay how the agents found the answer.</p>
          </div>
          <dl className="flex gap-5 text-right">
            {[
              { label: 'Total', value: sorted.length },
              { label: 'Running', value: running },
              { label: 'Autonomous', value: autonomous },
            ].map((s) => (
              <div key={s.label}>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{s.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums leading-tight">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {sorted.length === 0 ? (
          <Panel>
            <EmptyState title="No investigations yet">
              Ask your first question above. Results appear here as soon as the agents finish.
            </EmptyState>
          </Panel>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
            {sorted.map((investigation, i) => {
              const confidence = investigation.overallConfidence;
              const pct = confidence == null ? null : Math.round(confidence * 100);
              return (
                <li key={investigation.id} className={i > 0 ? 'border-t border-[var(--grid)]' : ''}>
                  <Link
                    href={`/investigations/${investigation.id}`}
                    className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] focus-visible:outline-none sm:flex-row sm:items-center sm:gap-5 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--text-primary)] group-hover:underline group-hover:underline-offset-4">
                        {investigation.question}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--text-muted)]">
                        {projectNames.has(investigation.projectId) && <span>{projectNames.get(investigation.projectId)}</span>}
                        <span>{formatTriggerType(investigation.triggerType)}</span>
                        <span className="tabular-nums">{formatDate(investigation.createdAt)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {pct != null && (
                        <span className="inline-flex items-center gap-2" title="Overall confidence">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden>
                            <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-9 text-right text-xs font-semibold tabular-nums">{pct}%</span>
                        </span>
                      )}
                      <StatusPill status={investigation.status} />
                      <span
                        className="hidden text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)] sm:inline"
                        aria-hidden
                      >
                        →
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
