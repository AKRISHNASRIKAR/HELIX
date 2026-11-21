import { getMe, getMembers, getProjects, isDemoMode, readRequestContext } from '../../../lib/api';
import { formatDate } from '../../../lib/investigations';
import { hasRole, resolveActiveMembership } from '../../../lib/session';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
import { AddMemberForm, CreateProjectForm } from './settings-forms';

export const metadata = { title: 'Settings · HELIX' };

export default async function SettingsPage() {
  if (isDemoMode()) {
    return (
      <main className="space-y-6">
        <PageHeader eyebrow="Workspace" title="Settings" />
        <Notice tone="info">Projects and members are managed against a real API. They are not available in demo mode.</Notice>
      </main>
    );
  }

  const [me, ctx, projects] = await Promise.all([getMe(), readRequestContext(), getProjects()]);
  const active = me ? resolveActiveMembership(me.memberships, ctx.organizationId) : null;
  const members = active ? await getMembers(active.organizationId) : null;
  const canMutate = hasRole(active?.role, 'MEMBER');
  const isAdmin = hasRole(active?.role, 'ADMIN');

  return (
    <main className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description={
          active ? (
            <>
              {active.organizationName} · you are {active.role === 'ADMIN' || active.role === 'OWNER' ? 'an' : 'a'}{' '}
              {active.role.toLowerCase()}
            </>
          ) : (
            'Organization details are unavailable right now.'
          )
        }
      />

      <section id="projects" className="scroll-mt-6">
        <Panel title="Projects" subtitle="Projects group related investigations">
          {projects === null ? (
            <Notice tone="error">Could not load projects.</Notice>
          ) : projects.length === 0 ? (
            <EmptyState title="No projects yet">Create one below to start asking questions.</EmptyState>
          ) : (
            <ul className="-mx-5 divide-y divide-[var(--grid)] border-y border-[var(--grid)]">
              {projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name}</p>
                    {p.description && <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{p.description}</p>}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Created {formatDate(p.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
          {canMutate ? (
            <div className="mt-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">New project</h3>
              <CreateProjectForm />
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--text-muted)]">Viewers can&apos;t create projects.</p>
          )}
        </Panel>
      </section>

      <section id="members" className="scroll-mt-6">
        <Panel title="Members" subtitle={active ? `People in ${active.organizationName}` : undefined}>
          {members === null ? (
            <Notice tone="error">Could not load members.</Notice>
          ) : (
            <div className="-mx-5 overflow-x-auto border-y border-[var(--grid)]">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-medium">Name</th>
                    <th scope="col" className="px-5 py-2 font-medium">Email</th>
                    <th scope="col" className="px-5 py-2 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--grid)]">
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td className="px-5 py-2.5 font-medium">
                        {m.name || '-'}
                        {m.userId === me?.user.id && <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">(you)</span>}
                      </td>
                      <td className="px-5 py-2.5 text-[var(--text-secondary)]">{m.email}</td>
                      <td className="px-5 py-2.5">
                        <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                          {m.role.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdmin && (
            <div className="mt-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Add member</h3>
              <AddMemberForm canGrantOwner={active?.role === 'OWNER'} />
            </div>
          )}
        </Panel>
      </section>
    </main>
  );
}
