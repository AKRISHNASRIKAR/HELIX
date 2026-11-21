import type { AgentSummary, Membership, Role } from './api';

/**
 * Pure session/tenant helpers (no I/O) shared by the layout, server actions
 * and middleware. Kept free of next/* imports so they're trivially testable.
 */

/** Paths reachable without a session (middleware lets these through). */
export const PUBLIC_PATHS = ['/login', '/signup', '/session/expired'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Sanitizes a post-login `next` target: only same-origin absolute paths,
 * never protocol-relative (`//evil.com`) or backslash tricks.
 */
export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\n')) return fallback;
  if (isPublicPath(raw.split('?')[0]!)) return fallback;
  return raw;
}

const ROLE_RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

/** True when `role` is at least `minimum` (OWNER > ADMIN > MEMBER > VIEWER). */
export function hasRole(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[minimum];
}

/**
 * Picks the active membership: the one named by the org cookie if the user
 * still belongs to it, otherwise the first membership (or null if none).
 */
export function resolveActiveMembership(
  memberships: Membership[],
  orgCookie: string | undefined,
): Membership | null {
  return memberships.find((m) => m.organizationId === orgCookie) ?? memberships[0] ?? null;
}

export interface AgentFleetSummary {
  total: number;
  online: number;
  busy: number;
  idle: number;
  unavailable: number;
}

/** Counts for the sidebar agent block. */
export function summarizeAgents(agents: AgentSummary[]): AgentFleetSummary {
  const busy = agents.filter((a) => a.status === 'BUSY').length;
  const idle = agents.filter((a) => a.status === 'IDLE').length;
  const unavailable = agents.filter((a) => a.status === 'UNAVAILABLE').length;
  return { total: agents.length, online: busy + idle, busy, idle, unavailable };
}

