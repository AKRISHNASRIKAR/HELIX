'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import type { RevenueStory } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { EASE } from '../motion';

/**
 * The anomaly day split by its most concentrated dimension: a ghost bar for
 * what each slice normally does on that weekday, a solid bar for what it did.
 * The slice that broke is red.
 */
export function DropBreakdown({ story }: { story: RevenueStory }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const show = inView || reduce;
  const max = Math.max(1, ...story.slices.flatMap((s) => [s.actual, s.expected]));
  const slices = [...story.slices].sort((a, b) => a.delta - b.delta);
  return (
    <div ref={ref}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-4xl font-semibold tracking-tight text-[var(--text-bad)] tabular-nums">
            {formatCurrency(story.delta)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            short of {formatCurrency(story.expected)} expected
          </p>
        </div>
        {story.dimension && (
          <p className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
            by <span className="font-mono">{story.dimension}</span>
          </p>
        )}
      </div>
      <ul className="mt-6 space-y-5">
        {slices.map((s, i) => {
          const broke = story.topSlice?.value === s.value && s.delta < 0;
          return (
            <li key={s.value}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium capitalize">{s.value}</span>
                <span className="tabular-nums">
                  <span className={`font-semibold ${broke ? 'text-[var(--text-bad)]' : ''}`}>
                    {s.deltaPercent == null ? '' : `${s.deltaPercent > 0 ? '+' : ''}${s.deltaPercent.toFixed(1)}%`}
                  </span>
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {formatCurrency(s.actual)} / {formatCurrency(s.expected)}
                  </span>
                </span>
              </div>
              <div className="relative h-6">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--band)]"
                  initial={reduce ? false : { width: 0 }}
                  animate={show ? { width: `${(s.expected / max) * 100}%` } : {}}
                  transition={{ duration: 0.8, delay: 0.1 * i, ease: EASE }}
                />
                <motion.div
                  className="absolute inset-y-[5px] left-0 rounded-[4px]"
                  style={{
                    background: broke ? 'var(--status-critical)' : 'var(--series-1)',
                    boxShadow: broke ? '0 0 18px -4px var(--status-critical)' : undefined,
                  }}
                  initial={reduce ? false : { width: 0 }}
                  animate={show ? { width: `${(s.actual / max) * 100}%` } : {}}
                  transition={{ duration: 1, delay: 0.5 + 0.12 * i, ease: EASE }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-[11px] text-[var(--text-muted)]">
        Dashed: a normal {story.weekday} (same weekday, previous 4 weeks). Solid: what happened.
      </p>
    </div>
  );
}
