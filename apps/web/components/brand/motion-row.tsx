'use client';

import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { EASE, motion } from '../motion';

/** A table row that fades and slides in, staggered by its index (capped). */
export function MotionRow({
  index,
  children,
  className,
  step = 0.03,
}: {
  index: number;
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.tr
      className={className}
      initial={reduce ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * step, 0.7), ease: EASE }}
    >
      {children}
    </motion.tr>
  );
}

/** Thin animated bar for a 0..1 share (for example a column's null rate). */
export function ShareBar({ value, tone = 'ink' }: { value: number; tone?: 'ink' | 'bad' }) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="block h-1 w-14 overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden>
      <motion.span
        className="block h-full rounded-full"
        style={{ background: tone === 'bad' ? 'var(--status-critical)' : 'var(--series-1)' }}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
      />
    </span>
  );
}
