'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

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
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
        compact ? 'px-2.5 py-1.5' : 'px-2.5 py-2'
      } ${
        active
          ? 'bg-[var(--canvas)] font-medium text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--canvas)]'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={icon} />
      </svg>
      {children}
    </Link>
  );
}
