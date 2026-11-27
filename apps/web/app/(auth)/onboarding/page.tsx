import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe, isDemoMode } from '../../../lib/api';
import { linkClass } from '../../../components/ui';
import { OnboardingForm } from './onboarding-form';

export const metadata = { title: 'Set up your workspace · HELIX' };

export default async function OnboardingPage() {
  if (isDemoMode()) redirect('/');
  const me = await getMe();
  const hasOrg = (me?.memberships.length ?? 0) > 0;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
          {hasOrg ? 'New organization' : 'Step 1 of 1'}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Set up your workspace</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Create an organization (you will be its owner) and a first project for your investigations.
        </p>
      </div>
      <OnboardingForm />
      {hasOrg && (
        <p className="text-center text-[13px] text-[var(--text-muted)]">
          <Link href="/" className={linkClass}>
            Back to dashboard
          </Link>
        </p>
      )}
    </div>
  );
}
