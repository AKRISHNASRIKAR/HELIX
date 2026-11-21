import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from './lib/session';

/**
 * Redirects unauthenticated requests to /login. This only checks that a
 * session cookie exists; the API validates the token itself, and a 401 from
 * it sends the user through /session/expired. Demo mode (HELIX_DEMO=1)
 * skips auth entirely.
 */
export function middleware(request: NextRequest) {
  if (process.env.HELIX_DEMO === '1') return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (request.cookies.get('helix_token')?.value) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip static assets and Next internals.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
