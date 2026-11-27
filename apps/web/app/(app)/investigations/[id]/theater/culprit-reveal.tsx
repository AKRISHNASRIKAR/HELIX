'use client';

import { useEffect, useRef } from 'react';
import { useSound } from '../../../../../components/experience';
import { CulpritAvatar, FixStepIcon } from '../../../../../components/culprit';
import { EASE, motion } from '../../../../../components/motion';
import { culpritChange, utcClock, utcShortDay, type Culprit } from '../../../../../lib/trace';

/** Seconds after the reveal mounts: the card lands once the four tiles are in. */
const CARD_AT = 2.2;
const STEPS_AT = 3.0;
const STEP_GAP = 0.55;

/**
 * The last beat of playback: who shipped the change behind the root cause,
 * then "How to fix" as numbered steps that land one by one, each with a soft
 * `finding` cue. `instant` (skip, reduced motion) shows everything at once
 * and stays silent.
 */
export function CulpritReveal({ culprit, instant }: { culprit: Culprit; instant: boolean }) {
  const play = useSound();
  const ref = useRef<HTMLDivElement>(null);
  const steps = culprit.fixPlan?.steps ?? [];

  useEffect(() => {
    if (instant) return;
    const timers = [
      window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), CARD_AT * 1000 + 250),
      ...steps.map((_, i) => window.setTimeout(() => play('finding'), (STEPS_AT + i * STEP_GAP) * 1000)),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
    // Once per mount (a replay remounts the reveal).
  }, []);

  const who = culprit.author ?? culpritChange(culprit);
  const clock = utcClock(culprit.deployedAt);
  const day = utcShortDay(culprit.deployedAt);
  const sha = culprit.commitSha?.slice(0, 7) ?? null;
  const d = (s: number) => (instant ? 0 : s);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 22, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: d(CARD_AT), ease: EASE }}
      className="relative mt-4 grid gap-6 overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
      aria-label={`Caused by ${who}`}
    >
      <div aria-hidden className="helix-dots pointer-events-none absolute inset-0 opacity-40" />
      {/* Identity */}
      <div className="relative min-w-0">
        <div className="flex items-center gap-4">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: d(CARD_AT + 0.25) }}
          >
            <CulpritAvatar handle={culprit.author ?? culprit.service} size="lg" />
          </motion.span>
          <div className="min-w-0">
            <p className="text-2xl font-semibold leading-tight tracking-tight sm:text-[30px]">
              <span className="text-[var(--text-bad)]">Caused by</span> <span className="break-all">{who}</span>
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Shipped <span className="font-medium text-[var(--text-primary)]">{culpritChange(culprit)}</span>
              {clock && ` at ${clock}`}
              {day && ` on ${day}`}
            </p>
          </div>
        </div>
        {culprit.description && (
          <blockquote className="mt-4 border-l-2 border-[var(--border-strong)] pl-3 text-[15px] italic leading-snug text-[var(--text-primary)]">
            &ldquo;{culprit.description}&rdquo;
          </blockquote>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {sha &&
            (culprit.commitUrl ? (
              <a
                href={culprit.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[var(--text-primary)] underline-offset-4 hover:underline"
                title={culprit.commitSha ?? undefined}
              >
                commit {sha} <span aria-hidden>↗</span>
              </a>
            ) : (
              <span
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[var(--text-secondary)]"
                title={culprit.commitSha ?? undefined}
              >
                commit {sha}
              </span>
            ))}
          {culprit.status && (
            <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 font-medium text-[var(--text-primary)]">
              {culprit.status.replace(/_/g, ' ')}
            </span>
          )}
          {culprit.environment && <span className="text-[var(--text-muted)]">{culprit.environment}</span>}
        </div>
      </div>

      {/* How to fix */}
      <div className="relative min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">How to fix</p>
        {steps.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <motion.li
                key={`${s.kind}-${i}`}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: d(STEPS_AT + i * STEP_GAP), ease: EASE }}
                className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[var(--accent-contrast)]">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold leading-snug text-[var(--text-primary)]">
                    <FixStepIcon kind={s.kind} className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    {s.title}
                  </p>
                  {s.detail && <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">{s.detail}</p>}
                </div>
              </motion.li>
            ))}
          </ol>
        ) : (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: d(STEPS_AT) }}
            className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--text-muted)]"
          >
            Run a new investigation for a step-by-step fix plan.
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
