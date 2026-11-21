import { NextResponse, type NextRequest } from 'next/server';
import { ORG_COOKIE, TOKEN_COOKIE } from '../../../lib/api';

/** The API rejected the token (401): drop the session and go back to /login. */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '?expired=1';
  const res = NextResponse.redirect(url);
  res.cookies.delete(TOKEN_COOKIE);
  res.cookies.delete(ORG_COOKIE);
  return res;
}
