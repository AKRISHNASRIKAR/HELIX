'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BELL_ICON } from './nav';
import { unreadBadge } from '../lib/notifications';

/** Window event the notification toaster dispatches with the latest unread count. */
export const UNREAD_EVENT = 'helix:unread';

/**
 * Bell link to /notifications with an animated unread badge. Starts from the
 * server-rendered count, then follows the toaster's polls: the badge pops on
 * every change and the bell rings when the count goes up.
 */
export function NotificationBell({ count: initial }: { count: number | null }) {
  const [count, setCount] = useState(initial);
  const [ring, setRing] = useState(0);
  const prev = useRef(initial);
  const reduce = useReducedMotion();

  // A fresh server render (navigation, revalidation) wins.
  useEffect(() => {
    setCount(initial);
    prev.current = initial;
  }, [initial]);

  useEffect(() => {
    const onUnread = (e: Event) => {
      const next = (e as CustomEvent<{ count: number }>).detail?.count;
      if (typeof next !== 'number') return;
      if (prev.current != null && next > prev.current) setRing((r) => r + 1);
      prev.current = next;
      setCount(next);
    };
    window.addEventListener(UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(UNREAD_EVENT, onUnread);
  }, []);

  const badge = unreadBadge(count);
  const label = count == null ? 'Notifications' : `Notifications, ${count === 0 ? 'none' : count} unread`;
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <motion.svg
        key={ring}
        viewBox="0 0 24 24"
        className="h-4 w-4 origin-top"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        initial={{ rotate: 0 }}
        animate={ring > 0 && !reduce ? { rotate: [0, -18, 16, -12, 8, -4, 0] } : { rotate: 0 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      >
        <path d={BELL_ICON} />
      </motion.svg>
      <AnimatePresence>
        {badge && (
          <motion.span
            key="badge"
            aria-hidden
            initial={reduce ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 22 }}
            className="absolute -right-0.5 -top-0.5 min-w-[16px]"
          >
            <span className="helix-ping absolute inset-0 rounded-full bg-[var(--status-critical)] opacity-60" />
            <motion.span
              key={badge}
              initial={reduce ? false : { scale: 1.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 18 }}
              className="relative block rounded-full bg-[var(--status-critical)] px-1 text-center text-[10px] font-semibold leading-4 text-[var(--accent-contrast)] tabular-nums shadow-[0_0_12px_var(--status-critical)] dark:text-[var(--text-primary)]"
            >
              {badge}
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
