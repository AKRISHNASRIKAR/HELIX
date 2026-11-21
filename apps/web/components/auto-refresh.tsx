'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-renders the current server component tree on an interval (used while an
 * investigation is still running). Pauses while the tab is hidden.
 */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]" role="status">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--series-1)]" aria-hidden />
      Live, updating every {Math.round(intervalMs / 1000)}s
    </span>
  );
}
