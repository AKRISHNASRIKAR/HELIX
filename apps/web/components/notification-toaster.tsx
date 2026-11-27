'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { pollNotifications, type NotificationPoll } from '../lib/actions/notifications';
import type { AppNotification } from '../lib/api';
import { notificationHref, notificationKind, notificationTypeLabel, type NotificationKind } from '../lib/notifications';
import { useSound } from './experience';
import { EASE } from './motion';
import { UNREAD_EVENT } from './notification-bell';

/** Dispatch this window event to make the toaster poll right away (e.g. after "Run now"). */
export const POLL_EVENT = 'helix:poll-notifications';
/** Fired with `{ fresh }` when new notifications arrive (the notifications page refreshes on it). */
export const ARRIVED_EVENT = 'helix:notifications-arrived';

const POLL_MS = 10_000;
const TOAST_MS = 9_000;

/**
 * Global toaster mounted once in the app layout. Polls the unread count every
 * 10 seconds while the tab is visible; when new notifications arrive it slides
 * a toast in (with the `notify` cue) that links to the investigation, and
 * tells the bell badge the new count.
 */
export function NotificationToaster() {
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const last = useRef<{ count: number; newestAt: string | null } | null>(null);
  const busy = useRef(false);
  const play = useSound();
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  const poll = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    let res: NotificationPoll | null = null;
    try {
      res = await pollNotifications(last.current);
    } catch {
      res = null;
    } finally {
      busy.current = false;
    }
    if (!res) return;
    const changed = last.current?.count !== res.count;
    last.current = { count: res.count, newestAt: res.newestAt };
    if (changed) window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: { count: res.count } }));
    if (res.fresh.length > 0) {
      const fresh = res.fresh;
      setToasts((t) => [...fresh, ...t.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, 3));
      playRef.current('notify');
      window.dispatchEvent(new CustomEvent(ARRIVED_EVENT, { detail: { fresh } }));
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    // A run that opens an investigation asks for a few quick polls so the toast lands fast.
    const timers: number[] = [];
    const onPoke = () => {
      for (const ms of [600, 2_000, 4_500]) timers.push(window.setTimeout(() => void poll(), ms));
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(POLL_EVENT, onPoke);
    return () => {
      window.clearInterval(id);
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(POLL_EVENT, onPoke);
    };
  }, [poll]);

  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return (
    <div
      aria-live="polite"
      aria-label="New notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col-reverse gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((n) => (
          <Toast key={n.id} n={n} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function KindGlyph({ kind }: { kind: NotificationKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden {...common}>
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

function Toast({ n, onDismiss }: { n: AppNotification; onDismiss: (id: string) => void }) {
  const reduce = useReducedMotion();
  const kind = notificationKind(n.type);
  const href = notificationHref(n);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => onDismiss(n.id), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [paused, n.id, onDismiss]);

  const tone =
    kind === 'failed'
      ? 'text-[var(--text-bad)] border-[var(--status-critical)]/50'
      : kind === 'opened'
        ? 'text-[var(--text-primary)] border-[var(--border-strong)]'
        : 'text-[var(--text-good)] border-[var(--border-strong)]';

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, x: 60, scale: 0.96, filter: 'blur(6px)' }}
      animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.25 } }}
      transition={{ duration: 0.5, ease: EASE }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="helix-beam pointer-events-auto relative overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]"
      role="status"
    >
      <div className="flex items-start gap-3 p-3.5 pr-9">
        <span className={`relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-[var(--surface-2)] ${tone}`}>
          {kind === 'opened' && <span className="helix-ping absolute inset-0 rounded-full bg-[var(--glow-strong)]" aria-hidden />}
          <KindGlyph kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {notificationTypeLabel(n.type)}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-[var(--text-primary)]">{n.body || n.title}</p>
          {href && (
            <Link
              href={href}
              onClick={() => onDismiss(n.id)}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              {kind === 'opened' ? 'Watch it run' : 'Open investigation'}
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        data-silent
        onClick={() => onDismiss(n.id)}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--canvas)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      {!reduce && (
        <motion.span
          key={paused ? 'paused' : 'running'}
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-[var(--accent)]"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: paused ? 1 : 0 }}
          transition={{ duration: paused ? 0 : TOAST_MS / 1000, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}
