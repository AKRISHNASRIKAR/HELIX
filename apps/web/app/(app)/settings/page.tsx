import { getMe, getMembers, getProjects, isDemoMode, readRequestContext } from '../../../lib/api';
import { formatDate } from '../../../lib/investigations';
import { hasRole, resolveActiveMembership } from '../../../lib/session';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
import { CountUp, Stagger } from '../../../components/motion';
import { MotionRow } from '../../../components/brand/motion-row';
import { AddMemberForm, CreateProjectForm } from './settings-forms';

function initials(name: string, email: string): string {
  const parts = (name.trim() || email).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

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
        <Panel
          title="Projects"
          subtitle="Projects group related investigations"
          action={
            projects && projects.length > 0 ? (
              <span className="text-2xl font-semibold tracking-tight">
                <CountUp value={projects.length} />
              </span>
            ) : undefined
          }
        >
          {projects === null ? (
            <Notice tone="error">Could not load projects.</Notice>
          ) : projects.length === 0 ? (
            <EmptyState title="No projects yet">Create one below to start asking questions.</EmptyState>
          ) : (
            <Stagger as="ul" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 transition-colors hover:border-[var(--border-strong)]"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-[var(--accent-contrast)]" aria-hidden>
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <p className="mt-3 text-sm font-semibold">{p.name}</p>
                  {p.description && <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{p.description}</p>}
                  <p className="mt-auto pt-3 text-[11px] text-[var(--text-muted)]">Created {formatDate(p.createdAt)}</p>
                </div>
              ))}
            </Stagger>
          )}
          {canMutate ? (
            <div className="mt-5 border-t border-[var(--border)] pt-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">New project</h3>
              <CreateProjectForm />
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--text-muted)]">Viewers can&apos;t create projects.</p>
          )}
        </Panel>
      </section>

      <section id="members" className="scroll-mt-6">
        <Panel
          title="Members"
          subtitle={active ? `People in ${active.organizationName}` : undefined}
          action={
            members && members.length > 0 ? (
              <span className="text-2xl font-semibold tracking-tight">
                <CountUp value={members.length} />
              </span>
            ) : undefined
          }
        >
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
                  {members.map((m, i) => (
                    <MotionRow key={m.userId} index={i} className="transition-colors hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-2.5 font-medium">
                        <span className="flex items-center gap-2.5">
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                              m.userId === me?.user.id
                                ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                                : 'border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
                            }`}
                            aria-hidden
                          >
                            {initials(m.name, m.email)}
                          </span>
                          <span>
                            {m.name || '-'}
                            {m.userId === me?.user.id && <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">(you)</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-[var(--text-secondary)]">{m.email}</td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            m.role === 'OWNER' || m.role === 'ADMIN'
                              ? 'border-[var(--border-strong)] text-[var(--text-primary)]'
                              : 'border-[var(--border)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {m.role.toLowerCase()}
                        </span>
                      </td>
                    </MotionRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdmin && (
            <div className="mt-5 border-t border-[var(--border)] pt-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Add member</h3>
              <AddMemberForm canGrantOwner={active?.role === 'OWNER'} />
            </div>
          )}
        </Panel>
      </section>
    </main>
  );
}
