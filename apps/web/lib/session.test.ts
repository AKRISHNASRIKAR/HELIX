import { describe, expect, it } from 'vitest';
import type { AgentSummary, Membership } from './api';
import { hasRole, isPublicPath, resolveActiveMembership, safeNextPath, summarizeAgents } from './session';

const m = (id: string, role: Membership['role'] = 'MEMBER'): Membership => ({
  organizationId: id,
  organizationName: `Org ${id}`,
  slug: id,
  role,
});

describe('safeNextPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/investigations/abc?x=1')).toBe('/investigations/abc?x=1');
  });
  it('rejects external, protocol-relative and auth-page targets', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
  });
});

describe('isPublicPath', () => {
  it('matches auth pages only', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/signup')).toBe(true);
    expect(isPublicPath('/session/expired')).toBe(true);
    expect(isPublicPath('/loginx')).toBe(false);
    expect(isPublicPath('/onboarding')).toBe(false);
    expect(isPublicPath('/')).toBe(false);
  });
});

describe('hasRole', () => {
  it('ranks OWNER > ADMIN > MEMBER > VIEWER', () => {
    expect(hasRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasRole('VIEWER', 'MEMBER')).toBe(false);
    expect(hasRole(null, 'VIEWER')).toBe(false);
  });
});

describe('resolveActiveMembership', () => {
  it('prefers the cookie org when still a member, else the first', () => {
    const list = [m('a'), m('b')];
    expect(resolveActiveMembership(list, 'b')?.organizationId).toBe('b');
    expect(resolveActiveMembership(list, 'gone')?.organizationId).toBe('a');
    expect(resolveActiveMembership(list, undefined)?.organizationId).toBe('a');
    expect(resolveActiveMembership([], 'a')).toBeNull();
  });
});

describe('summarizeAgents', () => {
  it('counts busy, idle and unavailable agents', () => {
    const agent = (status: AgentSummary['status']): AgentSummary => ({
      type: status,
      name: status,
      status,
      tasks: 0,
      successRate: null,
      avgMs: null,
    });
    expect(summarizeAgents([agent('BUSY'), agent('IDLE'), agent('IDLE'), agent('UNAVAILABLE')])).toEqual({
      total: 4,
      online: 3,
      busy: 1,
      idle: 2,
      unavailable: 1,
    });
    expect(summarizeAgents([])).toEqual({ total: 0, online: 0, busy: 0, idle: 0, unavailable: 0 });
  });
});
