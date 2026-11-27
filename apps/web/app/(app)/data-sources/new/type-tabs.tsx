'use client';

import Link from 'next/link';
import { motion } from '../../../../components/motion';
import { SourceIcon } from '../../../../components/brand/source-icon';

export interface TypeTab {
  key: string;
  label: string;
  icon: string;
}

/** Source-type switcher; the selected pill glides between options. */
export function TypeTabs({ tabs, current }: { tabs: readonly TypeTab[]; current: string }) {
  return (
    <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Source type">
      {tabs.map((tab) => {
        const on = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={`/data-sources/new?type=${tab.key}`}
            aria-current={on ? 'page' : undefined}
            scroll={false}
            className={`group relative flex flex-col items-start gap-3 rounded-xl border p-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              on
                ? 'border-transparent text-[var(--accent-contrast)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
            }`}
          >
            {on && (
              <motion.span
                layoutId="source-type-pill"
                className="absolute inset-0 rounded-xl bg-[var(--accent)] shadow-[0_10px_30px_-10px_var(--glow-strong)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                aria-hidden
              />
            )}
            <span className="relative transition-transform duration-300 group-hover:-translate-y-0.5">
              <SourceIcon type={tab.icon} className="h-5 w-5" />
            </span>
            <span className="relative">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
