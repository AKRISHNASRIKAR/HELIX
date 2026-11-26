import { getAgents, isDemoMode } from '../../../lib/api';
import { normalizeContextRequirements, requirementRows, sortAgents } from '../../../lib/agents';
import { formatPercent } from '../../../lib/format';
import { formatMs } from '../../../lib/trace';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';

export const metadata = { title: 'Agents · HELIX' };

const UNAVAILABLE = { dot: 'bg-[var(--status-critical)]', label: 'Unavailable' };
const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  BUSY: { dot: 'bg-[var(--series-1)]', label: 'Busy' },
  IDLE: { dot: 'bg-[var(--status-good)]', label: 'Idle' },
  UNAVAILABLE,
};

export default async function AgentsPage() {
  const agents = await getAgents();
  const sorted = agents ? sortAgents(agents) : [];

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Agents"
        title="Agent registry"
        description="The Coordinator plans each investigation and delegates to these specialist agents. Each one declares the context it needs; the Context Engine assembles exactly that before every task."
      />

      {agents === null ? (
        <Notice tone="error">Could not load agents. Check that the API and the agent runtime are running.</Notice>
      ) : sorted.length === 0 ? (
        <Panel>
          <EmptyState title="No agents registered">The agent runtime has not reported any agents yet.</EmptyState>
        </Panel>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Agents">
          {sorted.map((a) => {
            const status = STATUS_STYLE[a.status] ?? UNAVAILABLE;
            const req = requirementRows(normalizeContextRequirements(a.contextRequirements));
            const capabilities = a.capabilities ?? [];
            return (
              <li key={a.type}>
                <Panel className="h-full">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight">{a.name}</h2>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                        {a.type}
                        {a.version ? ` · v${a.version.replace(/^v/, '')}` : ''}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden />
                      {status.label}
                    </span>
                  </div>
                  {a.description && <p className="mt-2 text-[13px] text-[var(--text-secondary)]">{a.description}</p>}

                  <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-[var(--canvas)] p-3 text-center">
                    {[
                      ['Tasks', String(a.tasks)],
                      ['Success', a.successRate == null ? '-' : formatPercent(a.successRate, 0)],
                      ['Avg duration', formatMs(a.avgMs) ?? '-'],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[11px] text-[var(--text-muted)]">{label}</dt>
                        <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Capabilities</h3>
                  {capabilities.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {a.status === 'UNAVAILABLE' ? 'Unknown while the runtime is unreachable.' : 'None declared.'}
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {capabilities.map((c) => (
                        <li key={c.name} className="text-[13px]">
                          <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 font-mono text-xs">{c.name}</span>
                          {c.description && <span className="ml-2 text-[var(--text-secondary)]">{c.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Context requirements
                  </h3>
                  {req.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">Not reported by the runtime.</p>
                  ) : (
                    <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                      {req.map((r) => (
                        <div key={r.label} className="contents">
                          <dt className="text-[var(--text-muted)]">{r.label}</dt>
                          <dd className="break-words text-[var(--text-secondary)]">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
      {isDemoMode() && <p className="text-xs text-[var(--text-muted)]">Demo mode: agent data comes from fixtures.</p>}
    </main>
  );
}
