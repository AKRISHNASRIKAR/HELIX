import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavLink } from '../../components/nav-link';
import { NAV, SOON } from '../../components/nav';
import { LogoMark } from '../../components/logo';
import { OrgSwitcher } from '../../components/org-switcher';
import { logoutAction } from '../../lib/actions/auth';
import {
  getAgents,
  getMe,
  isDemoMode,
  readRequestContext,
  type AgentSummary,
  type Me,
  type Membership,
} from '../../lib/api';
import { summarizeAgents } from '../../lib/session';

// Every page here depends on the session cookies.
export const dynamic = 'force-dynamic';

/** Authenticated app chrome: sidebar (desktop), top bar (mobile), content. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemoMode();
  const [me, agents, ctx] = await Promise.all([getMe(), getAgents(), readRequestContext()]);

  let active: Membership | null = null;
  if (me) {
    if (me.memberships.length === 0) redirect('/onboarding');
    active = me.memberships.find((m) => m.organizationId === ctx.organizationId) ?? null;
    // Missing or stale org cookie: layouts can't set cookies, so let a route handler fix it.
    if (!active) redirect('/session/refresh');
  }

  const orgLabel = demo
    ? 'Acme Corp · Production'
    : active
      ? `${active.organizationName} · ${active.role.toLowerCase()}`
      : 'Workspace unavailable';

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-60 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] lg:block">
        <aside className="sticky top-0 flex h-screen flex-col px-4 py-5" aria-label="Sidebar">
          <div className="flex items-center gap-2.5 px-2">
            <LogoMark />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">HELIX</p>
              {me && active && me.memberships.length > 1 ? (
                <OrgSwitcher memberships={me.memberships} activeId={active.organizationId} />
              ) : (
                <p className="truncate text-[11px] text-[var(--text-muted)]">{orgLabel}</p>
              )}
            </div>
          </div>

          <nav className="mt-8 space-y-0.5" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href} icon={item.icon}>
                {item.label}
              </NavLink>
            ))}
            {SOON.map((label) => (
              <span key={label} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm text-[var(--text-muted)]">
                {label}
                <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-[10px]">soon</span>
              </span>
            ))}
          </nav>

          <div className="mt-auto space-y-3">
            <AgentFleetBlock agents={agents} />
            {me ? (
              <UserMenu me={me} />
            ) : demo ? (
              <p className="px-2 text-[11px] text-[var(--text-muted)]">Demo mode · sign-in disabled</p>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        <MobileBar me={me} orgLabel={orgLabel} />
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </div>
    </div>
  );
}

function AgentFleetBlock({ agents }: { agents: AgentSummary[] | null }) {
  if (!agents) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
        <p className="text-xs font-medium">Agent status unavailable</p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Could not reach the agent runtime.</p>
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
        <p className="text-xs font-medium">No agents registered</p>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Start the agent runtime to run investigations.</p>
      </div>
    );
  }
  const s = summarizeAgents(agents);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
      <p className="text-xs font-medium">
        {s.online} agent{s.online === 1 ? '' : 's'} online
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
        {s.busy} busy · {s.idle} idle · {s.unavailable} unavailable
      </p>
      <div className="mt-2 flex gap-1" aria-hidden>
        {agents.map((a) => (
          <span
            key={a.type}
            title={`${a.name}: ${a.status.toLowerCase()}`}
            className={`h-1.5 flex-1 rounded-full ${
              a.status === 'BUSY'
                ? 'bg-[var(--series-1)]'
                : a.status === 'IDLE'
                  ? 'bg-[var(--series-1-soft)]'
                  : 'bg-[var(--status-critical)] opacity-40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Disclosure-based user menu (no client JS needed). */
function UserMenu({ me }: { me: Me }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] [&::-webkit-details-marker]:hidden">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--series-1-soft)] text-[11px] font-semibold text-[#0d3d73]">
          {initials(me.user.name, me.user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{me.user.name || me.user.email}</span>
          <span className="block truncate text-[11px] text-[var(--text-muted)]">{me.user.email}</span>
        </span>
        <span className="text-[10px] text-[var(--text-muted)] transition-transform group-open:rotate-180" aria-hidden>
          ▴
        </span>
      </summary>
      <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
        <Link href="/settings" className="block rounded-md px-2.5 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]">
          Settings
        </Link>
        <Link href="/onboarding" className="block rounded-md px-2.5 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]">
          New organization
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--text-bad)] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

/** Small-screen top bar: brand, org, horizontally scrollable nav, sign out. */
function MobileBar({ me, orgLabel }: { me: Me | null; orgLabel: string }) {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] lg:hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight tracking-tight">HELIX</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">{orgLabel}</p>
          </div>
        </div>
        {me && (
          <form action={logoutAction}>
            <button type="submit" className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]">
              Sign out
            </button>
          </form>
        )}
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} icon={item.icon} compact>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
