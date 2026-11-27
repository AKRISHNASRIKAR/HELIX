'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import type { RevenueStory } from '../../lib/api';
import { formatCurrency, formatShortDate, formatUtcDay } from '../../lib/format';
import { useSound } from '../experience';
import { EASE, LiveDot, motion } from '../motion';
import { useReducedMotion } from 'motion/react';
import { AnimatedNumber } from './kpi-card';

export interface HeroInvestigation {
  id: string;
  question: string;
  confidence: number | null;
  why: string | null;
  because: string | null;
  duration: string | null;
}

export interface HeroProps {
  firstName?: string | null;
  story: RevenueStory | null;
  investigation: HeroInvestigation | null;
  sourceName?: string | null;
  seriesEnd?: string | null;
  stats: { label: string; value: number; unit?: 'count' | 'currency' }[];
}

/** Cinematic hero: the headline drop, then "what, when, where, why" in four big steps. */
export function DashboardHero({ firstName, story, investigation, sourceName, seriesEnd, stats }: HeroProps) {
  const play = useSound();
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = window.setTimeout(() => play('whoosh'), 150);
    return () => window.clearTimeout(t);
    // Once per mount only.
  }, []);

  const drop = story?.direction === 'drop';
  const pct = story?.deltaPercent != null ? Math.abs(story.deltaPercent) : null;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 18, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.8, ease: EASE }}
      className="helix-beam relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      aria-label="What HELIX found"
    >
      <div aria-hidden className="helix-dots pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-10%] h-80 w-[60%] rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${drop ? 'var(--anomaly-fill)' : 'var(--glow)'}, transparent)` }}
      />

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <p className="inline-flex items-center gap-2 font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <LiveDot tone={drop ? 'bad' : 'accent'} />
            {firstName ? `Welcome back, ${firstName}` : 'Overview'}
          </p>
          {seriesEnd && (
            <p className="text-[var(--text-muted)]">
              Data through {formatUtcDay(seriesEnd)}
              {sourceName && <span className="font-mono"> · {sourceName}</span>}
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            {story && pct != null ? (
              <h1 className="text-balance text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
                <span className="text-[var(--text-secondary)]">Revenue {drop ? 'fell' : 'jumped'}</span>{' '}
                <span className={drop ? 'text-[var(--text-bad)]' : ''}>
                  <AnimatedNumber value={pct} unit="percentPoints" duration={1.8} />
                </span>
                <br />
                <span>
                  on {story.weekday}, {formatShortDate(story.date)}
                </span>
              </h1>
            ) : (
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Here&apos;s what changed</h1>
            )}
            <p className="mt-4 max-w-2xl text-sm text-[var(--text-secondary)] sm:text-base">
              {story
                ? investigation
                  ? 'HELIX noticed it, sent four agents to dig in, and came back with a root cause.'
                  : 'HELIX flagged it as the biggest break in your data. Ask why, and four agents will dig in.'
                : 'Connect an orders table and HELIX will watch revenue, orders and refunds for you.'}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-6 lg:gap-8">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{s.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  <AnimatedNumber value={s.value} unit={s.unit ?? 'count'} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {story && <StoryStrip story={story} investigation={investigation} />}
      </div>
    </motion.section>
  );
}

function Step({
  n,
  label,
  big,
  detail,
  tone,
  delay,
  children,
}: {
  n: number;
  label: string;
  big: ReactNode;
  detail?: ReactNode;
  tone?: 'bad';
  delay: number;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
      className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/80 p-4 backdrop-blur-sm"
    >
      <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold ${
            tone === 'bad' ? 'bg-[var(--status-critical)] text-[var(--accent-contrast)]' : 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          }`}
        >
          {n}
        </span>
        {label}
      </p>
      <div className={`mt-3 text-2xl font-semibold leading-tight tracking-tight ${tone === 'bad' ? 'text-[var(--text-bad)]' : ''}`}>
        {big}
      </div>
      {detail && <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">{detail}</p>}
      {children}
    </motion.li>
  );
}

function StoryStrip({ story, investigation }: { story: RevenueStory; investigation: HeroInvestigation | null }) {
  const top = story.topSlice;
  const base = 0.5;
  const reduce = useReducedMotion();
  return (
    <div className="relative mt-8">
      {/* Connector that draws across the four steps */}
      <svg aria-hidden className="pointer-events-none absolute left-0 right-0 top-[26px] hidden h-2 w-full md:block" preserveAspectRatio="none" viewBox="0 0 100 2">
        <motion.line
          x1="2"
          x2="98"
          y1="1"
          y2="1"
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, delay: base, ease: EASE }}
        />
      </svg>
      <ol className="relative grid gap-3 md:grid-cols-4">
        <Step
          n={1}
          label="What dropped"
          tone={story.direction === 'drop' ? 'bad' : undefined}
          big={<>Revenue {formatCurrency(story.actual)}</>}
          detail={
            <>
              against {formatCurrency(story.expected)} expected
              {story.deltaPercent != null && ` (${story.deltaPercent > 0 ? '+' : ''}${story.deltaPercent.toFixed(1)}%)`}
            </>
          }
          delay={base}
        />
        <Step
          n={2}
          label="When"
          big={
            <>
              {story.weekday}, {formatShortDate(story.date)}
            </>
          }
          detail={`${story.severity} anomaly, ${Math.abs(story.zScore).toFixed(1)} standard deviations from normal`}
          delay={base + 0.25}
        />
        <Step
          n={3}
          label="Where"
          tone={top && top.delta < 0 ? 'bad' : undefined}
          big={
            top ? (
              <>
                <span className="capitalize">{top.value}</span>{' '}
                <span className="text-base font-medium">{top.column}</span>{' '}
                {top.deltaPercent != null && <span className="tabular-nums">{top.deltaPercent.toFixed(1)}%</span>}
              </>
            ) : (
              'Across the board'
            )
          }
          detail={
            top
              ? `${formatCurrency(top.actual)} vs ${formatCurrency(top.expected)} expected: ${top.shareOfDelta > 1 ? 'more than the entire shortfall on its own' : `${Math.round(top.shareOfDelta * 100)}% of the gap on its own`}`
              : 'No single slice explains it'
          }
          delay={base + 0.5}
        />
        <Step
          n={4}
          label="Why"
          big={
            investigation?.why ? (
              <span className="text-lg leading-snug">{investigation.why}</span>
            ) : (
              <span className="text-lg text-[var(--text-secondary)]">Not investigated yet</span>
            )
          }
          detail={investigation?.because ?? undefined}
          delay={base + 0.75}
        >
          <Link
            href={investigation ? `/investigations/${investigation.id}` : '/investigations#new'}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-primary)] underline-offset-4 hover:underline"
          >
            {investigation
              ? `See how HELIX found it${investigation.confidence != null ? `, ${Math.round(investigation.confidence * 100)}% sure` : ''}`
              : 'Ask HELIX why'}{' '}
            <span aria-hidden>→</span>
          </Link>
        </Step>
      </ol>
    </div>
  );
}
