import { NextResponse, type NextRequest } from 'next/server';
import { ORG_COOKIE, TOKEN_COOKIE, apiRequest, type Me } from '../../../lib/api';
import { resolveActiveMembership, safeNextPath } from '../../../lib/session';

/**
 * Re-resolves the active organization when the org cookie is missing or
 * points at an org the user no longer belongs to (layouts can't set cookies,
 * so they redirect here). Users without any org go to onboarding.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const to = (pathname: string) => NextResponse.redirect(new URL(pathname, request.nextUrl.origin));
  if (!token) return to('/login');

  const me = await apiRequest<Me>('/auth/me', { context: { token }, redirectOn401: false });
  if (!me.ok) return to(me.status === 401 ? '/session/expired' : '/');

  const active = resolveActiveMembership(me.data.memberships, request.cookies.get(ORG_COOKIE)?.value);
  if (!active) return to('/onboarding');

  const res = to(safeNextPath(request.nextUrl.searchParams.get('next')));
  res.cookies.set(ORG_COOKIE, active.organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
