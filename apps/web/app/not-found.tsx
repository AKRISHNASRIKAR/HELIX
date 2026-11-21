import Link from 'next/link';
import { buttonClass } from '../components/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        That page or record doesn&apos;t exist, or it belongs to another organization.
      </p>
      <Link href="/" className={`mt-4 ${buttonClass('secondary')}`}>
        ← Back to dashboard
      </Link>
    </main>
  );
}
