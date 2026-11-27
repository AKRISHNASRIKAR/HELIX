'use client';

import { CulpritAvatar, FIX_STEP_LABEL, FixStepIcon } from '../../../../../components/culprit';
import { EASE, Stagger, motion } from '../../../../../components/motion';
import { useReducedMotion } from 'motion/react';
import { culpritChange, utcClock, utcShortDay, type Culprit } from '../../../../../lib/trace';

interface Mark {
  key: string;
  label: string;
  title: string;
  when: string | null;
  tone: 'muted' | 'bad' | 'ink' | 'open';
}

/**
 * "Caused by": the deploy behind the root cause (who, what, which commit),
 * a horizontal change timeline from the last good version to recovery, and
 * the "How to fix" checklist. Red marks only the deploy itself.
 */
export function CulpritCard({
  culprit,
  broke,
}: {
  culprit: Culprit;
  /** The metric break from the root cause story, e.g. { label: 'Revenue -39.4%', date: '2026-10-08' }. */
  broke: { label: string; date: string } | null;
}) {
  const reduce = useReducedMotion();
  const who = culprit.author ?? culpritChange(culprit);
  const sha = culprit.commitSha?.slice(0, 7) ?? null;
  const clock = utcClock(culprit.deployedAt);
  const day = utcShortDay(culprit.deployedAt);
  const { previous, rollback } = culprit.history;
  const plan = culprit.fixPlan;

  const when = (iso: string | null) => [utcShortDay(iso), iso && iso.length > 10 ? utcClock(iso) : null].filter(Boolean).join(', ') || null;
  const marks: Mark[] = [];
  if (previous) {
    marks.push({
      key: 'previous',
      label: 'Last good version',
      title: previous.version ?? 'previous deploy',
      when: [when(previous.deployedAt), previous.author].filter(Boolean).join(' by ') || null,
      tone: 'muted',
    });
  }
  marks.push({
    key: 'deploy',
    label: 'This deploy',
    title: culprit.version ?? culpritChange(culprit),
    when: [when(culprit.deployedAt), culprit.author].filter(Boolean).join(' by ') || null,
    tone: 'bad',
  });
  if (broke) marks.push({ key: 'broke', label: 'Metric broke', title: broke.label, when: utcShortDay(broke.date), tone: 'ink' });
  if (rollback) {
    marks.push({
      key: 'rollback',
      label: 'Rolled back',
      title: rollback.version ?? 'rollback',
      when: [when(rollback.deployedAt), rollback.author].filter(Boolean).join(' by ') || null,
      tone: 'ink',
    });
  } else if (culprit.status === 'rolled_back') {
    // The deploy feed says it was rolled back, but the rollback deploy is not in the evidence.
    marks.push({ key: 'rollback', label: 'Rolled back', title: 'Later rolled back', when: null, tone: 'ink' });
  }
  if (plan && plan.recovered != null) {
    marks.push({
      key: 'recovery',
      label: plan.recovered ? 'Recovered' : 'Not recovered',
      title: plan.recovered ? 'Back to normal' : 'Still below expected',
      when: plan.recoveredThrough ? `checked through ${utcShortDay(plan.recoveredThrough)}` : null,
      tone: plan.recovered ? 'ink' : 'open',
    });
  }

  return (
    <motion.section
      aria-label={`Caused by ${who}`}
      initial={reduce ? false : { opacity: 0, y: 16, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, delay: 0.55, ease: EASE }}
      className="mt-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)] p-4 sm:p-5"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Who and what */}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-bad)]">Caused by</p>
          <div className="mt-2 flex items-center gap-3">
            <CulpritAvatar handle={culprit.author ?? culprit.service} size="md" />
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold tracking-tight">{who}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Shipped <span className="font-medium text-[var(--text-primary)]">{culpritChange(culprit)}</span>
                {clock && ` at ${clock}`}
                {day && ` on ${day}`}
              </p>
            </div>
          </div>
          {culprit.description && (
            <p className="mt-3 border-l-2 border-[var(--border-strong)] pl-3 text-[13px] italic leading-snug text-[var(--text-primary)]">
              &ldquo;{culprit.description}&rdquo;
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {sha &&
              (culprit.commitUrl ? (
                <a
                  href={culprit.commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={culprit.commitSha ?? undefined}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[var(--text-primary)] underline-offset-4 hover:underline"
                >
                  commit {sha} <span aria-hidden>↗</span>
                </a>
              ) : (
                <span title={culprit.commitSha ?? undefined} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[var(--text-secondary)]">
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
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">How to fix</p>
          {plan ? (
            <Stagger as="ol" className="mt-2 space-y-1.5" step={0.1} delay={0.7}>
              {plan.steps.map((s, i) => (
                <div key={`${s.kind}-${i}`} className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <span
                    className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--border-strong)] text-[var(--text-primary)]"
                    title={FIX_STEP_LABEL[s.kind]}
                  >
                    <FixStepIcon kind={s.kind} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">
                      <span className="mr-1.5 tabular-nums text-[var(--text-muted)]">{i + 1}.</span>
                      {s.title}
                    </p>
                    {s.detail && <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{s.detail}</p>}
                  </div>
                  <span className="ml-auto hidden shrink-0 self-start text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:inline">
                    {FIX_STEP_LABEL[s.kind]}
                  </span>
                </div>
              ))}
            </Stagger>
          ) : (
            <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2.5 text-xs text-[var(--text-muted)]">
              Run a new investigation for a step-by-step fix plan.
            </p>
          )}
        </div>
      </div>

      {/* Change timeline */}
      {marks.length > 1 && <ChangeTimeline marks={marks} reduce={!!reduce} />}
    </motion.section>
  );
}

function ChangeTimeline({ marks, reduce }: { marks: Mark[]; reduce: boolean }) {
  return (
    <div className="relative mt-5 overflow-x-auto border-t border-[var(--border)] pt-4">
      <p className="sr-only">Change timeline</p>
      <ol className="relative grid min-w-[520px] gap-2" style={{ gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))` }}>
        {/* The rail, drawn left to right behind the dots */}
        <motion.span
          aria-hidden
          className="absolute left-[6px] right-[6px] top-[5px] h-px origin-left bg-[var(--border-strong)]"
          initial={reduce ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, delay: 0.8, ease: EASE }}
        />
        {marks.map((m, i) => (
          <motion.li
            key={m.key}
            className="relative min-w-0"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.85 + i * 0.18, ease: EASE }}
          >
            <span
              aria-hidden
              className={`relative z-[1] block h-[11px] w-[11px] rounded-full border-2 ${
                m.tone === 'bad'
                  ? 'border-[var(--status-critical)] bg-[var(--status-critical)] shadow-[0_0_10px_var(--status-critical)]'
                  : m.tone === 'ink'
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)]'
                    : m.tone === 'open'
                      ? 'border-[var(--text-primary)] bg-[var(--surface-2)]'
                      : 'border-[var(--text-muted)] bg-[var(--surface-2)]'
              }`}
            />
            <p className={`mt-2 truncate text-[10px] font-semibold uppercase tracking-wider ${m.tone === 'bad' ? 'text-[var(--text-bad)]' : 'text-[var(--text-muted)]'}`}>
              {m.label}
            </p>
            <p className="truncate text-[13px] font-semibold tracking-tight" title={m.title}>
              {m.title}
            </p>
            {m.when && (
              <p className="truncate text-[10px] text-[var(--text-muted)]" title={m.when}>
                {m.when}
              </p>
            )}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
