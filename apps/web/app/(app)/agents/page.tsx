import { getAgents, isDemoMode, type AgentSummary } from '../../../lib/api';
import { humanizeCapability, normalizeContextRequirements, requirementChips, sortAgents } from '../../../lib/agents';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
import { LiveDot, Reveal, SpotlightCard, Stagger } from '../../../components/motion';
import { AgentGlyph } from '../../../components/brand/agent-glyph';
import { AgentFlow } from './agent-flow';
import { AgentStats } from './agent-stats';

export const metadata = { title: 'Agents · HELIX' };

const STATUS: Record<AgentSummary['status'], { label: string; tone: 'accent' | 'bad' | 'good' | null }> = {
  BUSY: { label: 'Working', tone: 'accent' },
  IDLE: { label: 'Ready', tone: null },
  UNAVAILABLE: { label: 'Unavailable', tone: 'bad' },
};

const STEP: Record<string, string> = {
  COORDINATOR: 'Steps 1 and 4',
  ANALYTICS: 'Step 2',
  FINANCE: 'Step 3',
  CUSTOMER: 'Step 3',
  PRODUCT: 'Step 3',
};

export default async function AgentsPage() {
  const agents = await getAgents();
  const sorted = agents ? sortAgents(agents) : [];
  const online = sorted.filter((a) => a.status !== 'UNAVAILABLE').length;

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Agents"
        title="Agent registry"
        description="Five specialists, one investigation. Each agent asks for exactly the context it needs, and the Context Engine assembles it before every task."
        actions={
          agents && agents.length > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              <LiveDot tone={online === sorted.length ? 'good' : 'bad'} />
              {online} of {sorted.length} online
            </span>
          ) : undefined
        }
      />

      {agents === null ? (
        <Notice tone="error">Could not load agents. Check that the API and the agent runtime are running.</Notice>
      ) : sorted.length === 0 ? (
        <Panel>
          <EmptyState title="No agents registered">The agent runtime has not reported any agents yet.</EmptyState>
        </Panel>
      ) : (
        <>
          <Reveal>
            <section className="helix-beam rounded-2xl">
              <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)] sm:p-6">
                <div className="helix-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
                <div className="relative">
                  <h2 className="text-sm font-semibold">How an investigation flows</h2>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">Every question or monitor alert follows this path.</p>
                  <div className="mt-5">
                    <AgentFlow agents={sorted.map((a) => ({ type: a.type, name: a.name, status: a.status }))} />
                  </div>
                </div>
              </div>
            </section>
          </Reveal>

          <Stagger as="ul" className="grid gap-4 lg:grid-cols-2" step={0.08}>
            {sorted.map((a) => (
              <AgentCard key={a.type} agent={a} />
            ))}
          </Stagger>
        </>
      )}
      {isDemoMode() && <p className="text-xs text-[var(--text-muted)]">Demo mode: agent data comes from fixtures.</p>}
    </main>
  );
}

function AgentCard({ agent: a }: { agent: AgentSummary }) {
  const status = STATUS[a.status] ?? STATUS.UNAVAILABLE;
  const groups = requirementChips(normalizeContextRequirements(a.contextRequirements));
  const capabilities = a.capabilities ?? [];
  return (
    <SpotlightCard className="h-full">
      <article className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_24px_-6px_var(--glow-strong)]">
            <AgentGlyph type={a.type} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{a.name}</h2>
              {STEP[a.type] && (
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {STEP[a.type]}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
              {a.type}
              {a.version ? ` · v${a.version.replace(/^v/, '')}` : ''}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              a.status === 'UNAVAILABLE'
                ? 'border-[var(--status-critical)]/40 text-[var(--text-bad)]'
                : 'border-[var(--border)] text-[var(--text-secondary)]'
            }`}
          >
            {status.tone ? <LiveDot tone={status.tone} /> : <span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" aria-hidden />}
            {status.label}
          </span>
        </div>

        {a.description && <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">{a.description}</p>}

        <div className="mt-4">
          <AgentStats tasks={a.tasks} successRate={a.successRate} avgMs={a.avgMs} />
        </div>

        <h3 className="mt-5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">What it can do</h3>
        {capabilities.length === 0 ? (
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {a.status === 'UNAVAILABLE' ? 'Unknown while the runtime is unreachable.' : 'None declared.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {capabilities.map((c, i) => (
              <li key={c.name} className="flex gap-2.5 text-[13px]">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-[var(--border)] font-mono text-[10px] text-[var(--text-muted)]">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-[var(--text-primary)]">{humanizeCapability(c.name)}</span>
                  {c.description && <span className="block text-[var(--text-secondary)]">{c.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Context it asks for</h3>
        {groups.length === 0 ? (
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not reported by the runtime.</p>
        ) : (
          <dl className="mt-2 space-y-2">
            {groups.map((g) => (
              <div key={g.label} className="flex flex-wrap items-baseline gap-1.5">
                <dt className="w-24 shrink-0 text-[11px] text-[var(--text-muted)]">{g.label}</dt>
                <dd className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {g.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      {chip}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </article>
    </SpotlightCard>
  );
}
