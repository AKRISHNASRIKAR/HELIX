import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isDemoMode } from '../../../lib/api';
import { safeNextPath } from '../../../lib/session';
import { Notice, linkClass } from '../../../components/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · HELIX' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  if (isDemoMode()) redirect('/');
  const { next, expired } = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Welcome back to HELIX.</p>
      </div>
      {expired && <Notice tone="info">Your session ended. Please sign in again.</Notice>}
      <LoginForm next={safeNextPath(next)} />
      <p className="text-center text-[13px] text-[var(--text-muted)]">
        New to HELIX?{' '}
        <Link href="/signup" className={`font-medium ${linkClass}`}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
