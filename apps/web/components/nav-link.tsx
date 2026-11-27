'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { motion } from './motion';

/**
 * Sidebar / mobile nav item. The active background is one shared element
 * (motion layoutId) that glides between items on navigation; the desktop
 * variant also carries a glowing bar on its left edge. Icons nudge on hover.
 */
export function NavLink({
  href,
  icon,
  children,
  compact = false,
}: {
  href: string;
  icon: string;
  children: ReactNode;
  /** Pill style for the horizontal mobile nav. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  // Separate layout groups so the desktop and mobile indicators never swap.
  const group = compact ? 'nav-mobile' : 'nav-desktop';
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex shrink-0 items-center gap-2.5 rounded-lg text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        compact ? 'px-2.5 py-1.5' : 'px-2.5 py-2'
      } ${active ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
    >
      {active && (
        <motion.span
          layoutId={`${group}-pill`}
          className="absolute inset-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-[var(--shadow)]"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          aria-hidden
        />
      )}
      {active && !compact && (
        <motion.span
          layoutId={`${group}-bar`}
          className="absolute -left-4 top-1/2 -mt-2.5 h-5 w-[3px] rounded-r-full bg-[var(--accent)] shadow-[0_0_12px_var(--glow-strong)]"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          aria-hidden
        />
      )}
      {!active && (
        <span
          className="absolute inset-0 rounded-lg bg-[var(--surface-2)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-hidden
        />
      )}
      <svg
        viewBox="0 0 24 24"
        className="relative h-4 w-4 transition-transform duration-300 ease-out group-hover:-translate-y-px group-hover:scale-110"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <motion.path
          d={icon}
          key={active ? 'on' : 'off'}
          initial={active ? { pathLength: 0.2, opacity: 0.4 } : false}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="relative">{children}</span>
    </Link>
  );
}
