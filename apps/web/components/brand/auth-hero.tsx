'use client';

import { LogoMark } from '../logo';
import { EASE, motion } from '../motion';
import { HelixCanvas } from './helix-canvas';
import { HowItWorks } from './how-it-works';

/** Left half of the auth screens: living helix, tagline, how-it-works loop. */
export function AuthHero() {
  return (
    <section
      aria-label="About HELIX"
      className="relative hidden min-h-screen overflow-hidden border-r border-[var(--border)] bg-[var(--surface-2)] lg:flex lg:flex-col"
    >
      <div className="helix-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 50% at 70% 40%, var(--glow), transparent 70%)' }}
        aria-hidden
      />
      {/* The helix sits on the right half so the copy on the left stays readable. */}
      <div className="absolute inset-y-0 right-0 w-[62%]">
        <HelixCanvas />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(90deg, var(--surface-2) 18%, transparent 62%)' }}
        aria-hidden
      />

      <div className="relative z-[1] flex flex-1 flex-col justify-between p-10 xl:p-14">
        <motion.div
          className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <LogoMark />
          <div>
            <p className="text-sm font-semibold tracking-tight">HELIX</p>
            <p className="text-[11px] text-[var(--text-muted)]">Autonomous investigation platform</p>
          </div>
        </motion.div>

        <div className="max-w-xl">
          <motion.p
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-1 text-xs text-[var(--text-secondary)] backdrop-blur"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          >
            <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
              <span className="helix-ping absolute inset-0 rounded-full bg-[var(--accent)]" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            </span>
            Five agents, one answer
          </motion.p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-tight xl:text-6xl">
            {['Autonomous', 'investigations', 'for your', 'business data.'].map((word, i) => (
              <motion.span
                key={word}
                className="block"
                initial={{ opacity: 0, y: 24, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.8, delay: 0.2 + i * 0.12, ease: EASE }}
              >
                {i === 3 ? <span className="text-[var(--text-secondary)]">{word}</span> : word}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="mt-5 max-w-md text-base text-[var(--text-secondary)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          >
            When a number moves, HELIX finds out why: it plans the investigation, sends agents into your data,
            and comes back with the root cause and the evidence behind it.
          </motion.p>
        </div>

        <motion.div
          className="max-w-2xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1, ease: EASE }}
        >
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">How it works</p>
          <HowItWorks />
        </motion.div>
      </div>
    </section>
  );
}
