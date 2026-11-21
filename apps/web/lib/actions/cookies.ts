import { cookies } from 'next/headers';
import { ORG_COOKIE, TOKEN_COOKIE } from '../api';

/** Matches the API's default JWT_EXPIRES_IN (12h); the API remains the source of truth. */
const SESSION_MAX_AGE = 60 * 60 * 12;
const ORG_MAX_AGE = 60 * 60 * 24 * 365;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export async function setSessionToken(token: string) {
  (await cookies()).set(TOKEN_COOKIE, token, cookieOptions(SESSION_MAX_AGE));
}

export async function setActiveOrg(organizationId: string) {
  (await cookies()).set(ORG_COOKIE, organizationId, cookieOptions(ORG_MAX_AGE));
}

export async function clearSession() {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(ORG_COOKIE);
}
