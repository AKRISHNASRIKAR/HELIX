import Link from 'next/link';
import { StatusPill } from '@helix/ui';
import { getInvestigations, getProjects, isDemoMode } from '../../../lib/api';
import { formatDate, formatTriggerType } from '../../../lib/investigations';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
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

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Investigations"
        title="Investigations"
        description="Every question asked of HELIX. The Coordinator plans each one, delegates to specialist agents and synthesizes a root cause."
      />

      <section id="new" className="scroll-mt-6">
        <Panel title="New investigation" subtitle="Ask a question about your connected data">
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
        </Panel>
      </section>

      {sorted.length === 0 ? (
        <Panel>
          <EmptyState title="No investigations yet">
            Ask your first question above. Results appear here as soon as the agents finish.
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Question</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Trigger</th>
                  <th scope="col" className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--grid)]">
                {sorted.map((investigation) => (
                  <tr key={investigation.id} className="hover:bg-[var(--canvas)]">
                    <td className="px-5 py-3">
                      <Link
                        href={`/investigations/${investigation.id}`}
                        className="rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]"
                      >
                        {investigation.question}
                      </Link>
                      {projectNames.has(investigation.projectId) && (
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{projectNames.get(investigation.projectId)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={investigation.status} />
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">{formatTriggerType(investigation.triggerType)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-[var(--text-secondary)]">{formatDate(investigation.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}
