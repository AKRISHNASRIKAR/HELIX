'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { AppNotification } from '../../../lib/api';
import { notificationHref, notificationKind, notificationTypeLabel, type NotificationKind } from '../../../lib/notifications';
import { formatRelative } from '../../../lib/format';
import { EASE } from '../../../components/motion';
import { ARRIVED_EVENT } from '../../../components/notification-toaster';
import { MarkReadButton } from './notification-actions';
import { CausedByText } from '../../../components/culprit';

const KIND_STYLE: Record<NotificationKind, { ring: string; text: string }> = {
  opened: { ring: 'border-[var(--accent)] shadow-[0_0_20px_-6px_var(--glow-strong)]', text: 'text-[var(--text-primary)]' },
  completed: { ring: 'border-[var(--border-strong)]', text: 'text-[var(--text-good)]' },
  failed: { ring: 'border-[var(--status-critical)] shadow-[0_0_20px_-6px_var(--status-critical)]', text: 'text-[var(--text-bad)]' },
  other: { ring: 'border-[var(--border-strong)]', text: 'text-[var(--text-secondary)]' },
};

function Glyph({ kind }: { kind: NotificationKind }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === 'opened' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 12 18.5 5.5" />
        </>
      ) : kind === 'completed' ? (
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      ) : kind === 'failed' ? (
        <path d="M6 6l12 12M18 6 6 18" />
      ) : (
        <path d="M12 7v6M12 17h.01" />
      )}
    </svg>
  );
}

/** Refreshes the server-rendered feed when the global toaster sees new notifications. */
function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const onArrived = () => router.refresh();
    window.addEventListener(ARRIVED_EVENT, onArrived);
    return () => window.removeEventListener(ARRIVED_EVENT, onArrived);
  }, [router]);
  return null;
}

function FeedItem({ n, index }: { n: AppNotification; index: number }) {
  const reduce = useReducedMotion();
  const kind = notificationKind(n.type);
  const style = KIND_STYLE[kind];
  const href = notificationHref(n);
  const unread = !n.readAt;
  return (
    <motion.li
      layout
      initial={reduce ? false : { opacity: 0, x: 24, filter: 'blur(4px)' }}
      animate={{ opacity: unread ? 1 : 0.62, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.5, delay: Math.min(index, 12) * 0.05, ease: EASE }}
      className="relative pl-12"
    >
      <span
        className={`absolute left-0 top-3 grid h-9 w-9 place-items-center rounded-full border bg-[var(--surface-raised)] ${unread ? style.ring : 'border-[var(--border)]'} ${style.text}`}
      >
        {unread && kind === 'opened' && <span aria-hidden className="helix-ping absolute inset-0 rounded-full bg-[var(--glow)]" />}
        <Glyph kind={kind} />
      </span>
      <article
        className={`group rounded-2xl border p-4 transition-[border-color,transform] duration-300 hover:-translate-y-px ${
          unread
            ? 'border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow)]'
            : 'border-[var(--border)] bg-[var(--surface-2)]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {unread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-critical)] shadow-[0_0_8px_var(--status-critical)]" aria-hidden />}
            {notificationTypeLabel(n.type)}
            {unread && <span className="sr-only"> (unread)</span>}
          </p>
          <time dateTime={n.createdAt} title={new Date(n.createdAt).toUTCString()} className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
            {formatRelative(n.createdAt)}
          </time>
        </div>
        <p className={`mt-1.5 text-[15px] leading-snug tracking-tight ${unread ? 'font-semibold' : 'font-medium'}`}>{n.title}</p>
        {n.body && (
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            <CausedByText text={n.body} />
          </p>
        )}
        {(href || unread) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {href ? (
              <Link
                href={href}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  kind === 'opened' ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-primary)]'
                }`}
              >
                {kind === 'opened' ? 'Watch it run' : 'Open investigation'} <span aria-hidden>→</span>
              </Link>
            ) : (
              <span />
            )}
            {unread && <MarkReadButton id={n.id} title={n.title} />}
          </div>
        )}
      </article>
    </motion.li>
  );
}

export function NotificationFeed({ groups }: { groups: { label: string; items: AppNotification[] }[] }) {
  const offsets = groups.map((_, gi) => groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0));
  return (
    <div className="space-y-8">
      <LiveRefresh />
      {groups.map((group, gi) => (
        <section key={group.label} aria-label={group.label} className="relative">
          <h2 className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {group.label}
            <span className="h-px flex-1 bg-gradient-to-r from-[var(--border)] to-transparent" aria-hidden />
          </h2>
          <div className="relative">
            <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-px bg-gradient-to-b from-[var(--border-strong)] via-[var(--border)] to-transparent" />
            <ul className="space-y-3">
              <AnimatePresence initial={true}>
                {group.items.map((n, i) => (
                  <FeedItem key={n.id} n={n} index={offsets[gi]! + i} />
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
