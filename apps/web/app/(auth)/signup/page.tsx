import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isDemoMode } from '../../../lib/api';
import { linkClass } from '../../../components/ui';
import { SignupForm } from './signup-form';

export const metadata = { title: 'Create account · HELIX' };

export default function SignupPage() {
  if (isDemoMode()) redirect('/');
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Get started</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Connect your data and let HELIX agents find out why your metrics moved.
        </p>
      </div>
      <SignupForm />
      <p className="text-center text-[13px] text-[var(--text-muted)]">
        Already have an account?{' '}
        <Link href="/login" className={`font-medium ${linkClass}`}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
