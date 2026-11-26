import Link from 'next/link';
import { BELL_ICON } from './nav';
import { unreadBadge } from '../lib/notifications';

/** Bell link to /notifications with the unread count badge (server component). */
export function NotificationBell({ count }: { count: number | null }) {
  const badge = unreadBadge(count);
  const label =
    count == null ? 'Notifications' : `Notifications, ${count === 0 ? 'none' : count} unread`;
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={BELL_ICON} />
      </svg>
      {badge && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[var(--status-critical)] px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
