'use client';

import Link from 'next/link';
import { EASE, LiveDot, Typewriter, motion } from '../../../../../components/motion';
import { buttonClass } from '../../../../../components/ui';
import { formatMs } from '../../../../../lib/trace';
import type { Timeline } from '../../../../../lib/theater';
import { ConfidenceRing } from './confidence-ring';

/** The climax: root cause statement, confidence ring and What / When / Where / Why tiles. */
export function Reveal({
  timeline,
  investigationId,
  onReplay,
  instant,
}: {
  timeline: Timeline;
  investigationId: string;
  onReplay: () => void;
  instant: boolean;
}) {
  const root = timeline.rootCause;
  if (!root) return null;
  const real = formatMs(timeline.realTotal);
  return (
    <motion.section
      initial={{ opacity: 0, y: 28, filter: 'blur(10px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.8, ease: EASE }}
      className="relative overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-lg)] sm:p-7"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[80%] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--glow-strong), transparent)' }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-bad)]">
            <LiveDot tone="bad" /> Root cause found
          </p>
          <p className="mt-3 text-xl font-semibold leading-snug tracking-tight text-[var(--text-primary)] sm:text-2xl lg:text-[28px] lg:leading-[1.25]">
            {instant ? root.statement : <Typewriter text={root.statement} speed={11} delay={500} />}
          </p>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            {timeline.findingTotal} findings and {timeline.evidenceTotal} pieces of evidence
            {real ? `, all gathered in ${real} of real time` : ''}.
          </p>
        </div>
        {timeline.confidence != null && <ConfidenceRing value={timeline.confidence} delay={0.4} size={148} />}
      </div>

      {timeline.tiles.length > 0 && (
        <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {timeline.tiles.map((tile, i) => {
            const bad = tile.key === 'what' && /-\d/.test(tile.value);
            return (
              <motion.div
                key={tile.key}
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.6, delay: (instant ? 0 : 0.9) + i * 0.18, ease: EASE }}
                className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <span
                  aria-hidden
                  className="absolute -right-2 -top-5 select-none text-[84px] font-black leading-none text-[var(--grid)]"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">{tile.label}</p>
                <p
                  className={`relative mt-2 break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl ${
                    bad ? 'text-[var(--text-bad)]' : 'text-[var(--text-primary)]'
                  }`}
                >
                  {tile.value}
                </p>
                {tile.detail && <p className="relative mt-1.5 text-xs leading-snug text-[var(--text-secondary)]">{tile.detail}</p>}
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="relative mt-6 flex flex-wrap items-center gap-3">
        <Link href={`/investigations/${investigationId}`} scroll={false} className={buttonClass('primary', 'md')}>
          See the evidence <span aria-hidden>→</span>
        </Link>
        <button type="button" onClick={onReplay} className={buttonClass('secondary', 'md')}>
          <span aria-hidden>↺</span> Replay
        </button>
      </div>
    </motion.section>
  );
}
