'use client';

import { memo } from 'react';
import { AnimatePresence, EASE, motion } from '../../../../../components/motion';
import { agentLabel } from '../../../../../lib/trace';
import type { Beat } from '../../../../../lib/theater';

/** Growing column of findings, newest on top, each with a filling confidence bar. */
export const FindingsFeed = memo(function FindingsFeed({
  findings,
  total,
  dimmed,
}: {
  findings: Beat[];
  total: number;
  dimmed: boolean;
}) {
  const list = [...findings].reverse();
  return (
    <motion.aside
      className="flex min-h-0 flex-col"
      animate={{ opacity: dimmed ? 0.35 : 1 }}
      transition={{ duration: 0.5 }}
      aria-label="Findings"
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Findings</p>
        <p className="text-xs tabular-nums text-[var(--text-secondary)]">
          <span className="text-base font-semibold text-[var(--text-primary)]">{findings.length}</span> / {total}
        </p>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--grid)]">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          animate={{ width: total ? `${(findings.length / total) * 100}%` : '0%' }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      </div>
      <ol className="mt-3 flex max-h-[360px] min-h-[120px] flex-col gap-2 overflow-y-auto pr-1">
        {list.length === 0 && (
          <li className="rounded-xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            Findings land here as agents report back.
          </li>
        )}
        <AnimatePresence initial={false}>
          {list.map((b) => (
            <motion.li
              key={b.id}
              layout
              initial={{ opacity: 0, x: -60, scale: 0.9, filter: 'blur(6px)' }}
              animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-md border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {agentLabel(b.agentType ?? 'agent')}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {(b.finding?.analyticsType ?? '').toLowerCase()}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-[var(--text-primary)]">{b.label}</p>
              {b.finding && <Confidence value={b.finding.confidence} />}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </motion.aside>
  );
});

function Confidence({ value }: { value: number }) {
  const p = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--grid)]">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--glow-strong)]"
          initial={{ width: '0%' }}
          animate={{ width: `${p}%` }}
          transition={{ duration: 0.9, delay: 0.15, ease: EASE }}
        />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">{p}%</span>
    </div>
  );
}
