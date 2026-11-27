'use client';

import type { ReactNode } from 'react';
import type { RootCauseStory } from '../../../../../lib/trace';
import { CueOnView, LiveDot, Reveal, Stagger } from '../../../../../components/motion';
import { ConfidenceRing, DeltaBars, EventTimeline, SeriesChart, ValueVsExpected, fmtPct, fmtValue } from './charts';

const longDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * The root cause told as a story: one big sentence, a confidence ring and
 * four tiles (what dropped, when, where, why), each with a small chart drawn
 * from the evidence the Coordinator ranked. Plays the `rootCause` cue once.
 */
export function StoryHero({ story, contributors }: { story: RootCauseStory; contributors: number }) {
  const { what, where, volume, why } = story;
  const tiles: ReactNode[] = [];

  if (what) {
    tiles.push(
      <Tile key="what" n={1} label="What dropped" bad>
        <p className="truncate text-sm font-medium capitalize text-[var(--text-secondary)]">{what.metricName.replace(/\s*\(daily\)/i, '')}</p>
        <p className="mt-0.5 text-4xl font-semibold tracking-tight tabular-nums text-[var(--text-bad)]">
          {what.changePercent != null ? fmtPct(what.changePercent) : fmtValue(what.value, what.unit)}
        </p>
        <div className="mt-3">
          {what.expected != null && <ValueVsExpected value={what.value} expected={what.expected} unit={what.unit} />}
        </div>
      </Tile>,
    );
    tiles.push(
      <Tile key="when" n={2} label="When">
        <p className="text-2xl font-semibold tracking-tight">{longDay(what.date)}</p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {what.severity ? `${what.severity.toLowerCase()} anomaly` : 'anomaly'}
          {what.deviationScore != null && `, deviation score ${what.deviationScore.toFixed(1)}`}
        </p>
        <div className="mt-2">
          {what.series.length > 1 ? (
            <SeriesChart
              series={what.series}
              highlight={what.date}
              expected={what.expected}
              others={what.otherAnomalies.map((a) => a.date)}
              unit={what.unit}
              height={70}
            />
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No daily series recorded.</p>
          )}
        </div>
      </Tile>,
    );
  }

  const top = where?.top ?? volume?.top;
  const seg = where ?? volume;
  if (seg && top) {
    tiles.push(
      <Tile key="where" n={3} label="Where" bad>
        <p className="text-2xl font-semibold tracking-tight">
          {top.value} <span className="text-base font-normal text-[var(--text-secondary)]">{seg.column}</span>
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {top.deltaPercent != null && <span className="font-semibold text-[var(--text-bad)]">{fmtPct(top.deltaPercent)}</span>}
          {top.shareOfDelta != null &&
            (top.shareOfDelta > 1
              ? ', more than the entire shortfall on its own'
              : `, carries ${Math.round(top.shareOfDelta * 100)}% of the shortfall`)}
        </p>
        <div className="mt-3">
          <DeltaBars slices={seg.slices} unit={seg.unit} highlight={top.value} />
        </div>
        {volume?.top && where && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            {volume.metricName}: {volume.top.value} {fmtValue(volume.top.actual, volume.unit)} vs{' '}
            {fmtValue(volume.top.expected, volume.unit)} expected
          </p>
        )}
      </Tile>,
    );
  }

  if (why && (why.date ?? what?.date)) {
    const h = why.hoursBefore;
    tiles.push(
      <Tile key="why" n={4} label="Why">
        <p className="break-words text-xl font-semibold leading-tight tracking-tight" title={why.label}>
          {why.label}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          deploy
          {h != null && (h < 0 ? `, ${Math.abs(h).toFixed(1)}h into the drop day` : `, ${h.toFixed(1)}h before the drop day`)}
          {why.status && (
            <span className="ml-1.5 rounded-full border border-[var(--border-strong)] px-1.5 py-px text-[10px] font-medium text-[var(--text-primary)]">
              {why.status.replace(/_/g, ' ')}
            </span>
          )}
        </p>
        <EventTimeline day={(why.date ?? what?.date)!} main={why} others={story.otherEvents} />
        {why.description && <p className="mt-2 line-clamp-2 text-[11px] text-[var(--text-secondary)]">{why.description}</p>}
      </Tile>,
    );
  }

  const ruled = story.ruledOut.flatMap((s) => s.slices.map((sl) => ({ col: s.column, ...sl })));

  return (
    <CueOnView cue="rootCause">
      <section
        aria-label="Root cause"
        className="helix-beam relative overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)] sm:p-7"
      >
        <div className="helix-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--glow-strong), transparent 70%)' }}
          aria-hidden
        />
        <div className="relative">
          <Reveal className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                <LiveDot tone="bad" /> Root cause found
                {story.agentType === 'COORDINATOR' && (
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[var(--text-secondary)]">
                    Coordinator ranked {contributors} finding{contributors === 1 ? '' : 's'}
                  </span>
                )}
              </p>
              <h2 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight tracking-tight sm:text-[2rem]">{story.headline}</h2>
              {story.headline !== story.statement && (
                <p className="mt-3 max-w-4xl text-[13px] leading-relaxed text-[var(--text-secondary)]">{story.statement}</p>
              )}
            </div>
            {story.confidence != null && <ConfidenceRing value={story.confidence} />}
          </Reveal>

          {tiles.length > 0 && (
            <Stagger className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" step={0.12} delay={0.2}>
              {tiles}
            </Stagger>
          )}

          {(ruled.length > 0 || story.signals.length > 0) && (
            <Reveal delay={0.5} className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-8">
              {ruled.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Ruled out</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {ruled.map((r) => (
                      <li
                        key={`${r.col}-${r.value}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--border-strong)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                        title={`${r.col} ${r.value} moved with the total`}
                      >
                        <span aria-hidden className="text-[var(--text-muted)]">✕</span>
                        <span className="line-through decoration-[var(--text-muted)]">{r.value.replace(/_/g, ' ')}</span>
                        {r.deltaPercent != null && <span className="tabular-nums text-[var(--text-muted)]">{fmtPct(r.deltaPercent, 0)}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {story.ruledOut[0]!.column.replace(/_/g, ' ')} mix moved together, so it is not the driver
                  </p>
                </div>
              )}
              {story.signals.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Also moved</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {story.signals.map((s) => (
                      <li
                        key={`${s.metricName}-${s.date}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--anomaly-fill)] px-2.5 py-1 text-[11px] text-[var(--text-primary)]"
                      >
                        <span className="font-medium">{s.metricName}</span>
                        <span className="text-[var(--text-muted)]">{longDay(s.date)}</span>
                        {s.changePercent != null && (
                          <span className="font-semibold tabular-nums text-[var(--text-bad)]">{fmtPct(s.changePercent, 0)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Reveal>
          )}
        </div>
      </section>
    </CueOnView>
  );
}

function Tile({ n, label, bad = false, children }: { n: number; label: string; bad?: boolean; children: ReactNode }) {
  return (
    <div className="h-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 transition-colors hover:border-[var(--border-strong)]">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
            bad ? 'bg-[var(--status-critical)] text-[var(--accent-contrast)]' : 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          }`}
        >
          {n}
        </span>
        {label}
      </p>
      {children}
    </div>
  );
}
