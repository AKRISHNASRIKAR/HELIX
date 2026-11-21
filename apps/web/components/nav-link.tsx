'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
        active
          ? 'bg-[var(--canvas)] font-medium text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--canvas)]'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
      {children}
    </Link>
  );
}
