'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplayStep, ReplayStepKind } from '../../../../lib/trace';
import { buttonClass } from '../../../../components/ui';

const KIND_LABEL: Record<ReplayStepKind, string> = {
  question: 'Trigger',
  plan: 'Plan',
  dispatch: 'Dispatch',
  result: 'Result',
  findings: 'Findings',
  rootCause: 'Root cause',
  recommendations: 'Recommendations',
  summary: 'Summary',
};

const KIND_DOT: Record<ReplayStepKind, string> = {
  question: 'bg-[var(--text-primary)]',
  plan: 'bg-[var(--text-secondary)]',
  dispatch: 'bg-[var(--series-1-soft)]',
  result: 'bg-[var(--series-1)]',
  findings: 'bg-[var(--series-3)]',
  rootCause: 'bg-[var(--series-2)]',
  recommendations: 'bg-[var(--series-3)]',
  summary: 'bg-[var(--status-good)]',
};

const STEP_MS = 2500;

function clock(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Step-through player for a reconstructed investigation run. */
export function ReplayPlayer({ steps }: { steps: ReplayStep[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const last = steps.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setIndex((i) => Math.min(last, i + 1)), STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, index, last]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-step="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (steps.length === 0) return null;
  const current = steps[Math.min(index, last)]!;

  const togglePlay = () => {
    if (!playing && index >= last) setIndex(0);
    setPlaying((p) => !p);
  };

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === 'ArrowRight') setIndex((i) => Math.min(last, i + 1));
        if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      }}
    >
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 lg:self-start">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--grid)] px-1 pb-3">
          <button type="button" onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }} disabled={index === 0} className={buttonClass('secondary')} aria-label="Previous step">
            ← Prev
          </button>
          <button type="button" onClick={togglePlay} className={buttonClass('primary')} aria-pressed={playing}>
            {playing ? 'Pause' : index >= last ? 'Replay' : 'Play'}
          </button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((i) => Math.min(last, i + 1)); }} disabled={index >= last} className={buttonClass('secondary')} aria-label="Next step">
            Next →
          </button>
          <span className="ml-auto text-xs tabular-nums text-[var(--text-muted)]" aria-live="polite">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <div className="px-1 pt-3">
          <label htmlFor="replay-scrub" className="sr-only">
            Replay position
          </label>
          <input
            id="replay-scrub"
            type="range"
            min={0}
            max={last}
            value={index}
            onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
            className="w-full accent-[var(--series-1)]"
          />
        </div>
        <ol ref={listRef} className="mt-2 max-h-[520px] space-y-0.5 overflow-y-auto" aria-label="Replay steps">
          {steps.map((s, i) => {
            const isCurrent = i === index;
            const done = i < index;
            return (
              <li key={s.id} data-step={i}>
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setIndex(i); }}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] ${
                    isCurrent ? 'bg-[#f3f8fe] ring-1 ring-[var(--series-1)]' : 'hover:bg-[var(--canvas)]'
                  } ${!isCurrent && !done ? 'opacity-60' : ''}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[s.kind]}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {KIND_LABEL[s.kind]}
                      {clock(s.at) && <span className="ml-1.5 normal-case tracking-normal">{clock(s.at)}</span>}
                    </span>
                    <span className="block truncate text-[13px] font-medium">{s.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <section
        aria-live="polite"
        aria-label="Current replay step"
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 lg:sticky lg:top-6 lg:self-start"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {KIND_LABEL[current.kind]}
          {current.wave != null && ` · wave ${current.wave + 1}`}
          {clock(current.at) && ` · ${clock(current.at)}`}
        </p>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">{current.title}</h3>
        {current.description && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">{current.description}</p>
        )}

        {current.messages.length > 0 && (
          <div className="mt-4">
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">A2A messages</h4>
            <ul className="mt-1.5 space-y-1.5">
              {current.messages.map((m) => (
                <li key={m.id} className="rounded-lg border border-[var(--grid)] px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        m.type === 'ERROR' ? 'bg-[#fbe4e4] text-[var(--text-bad)]' : 'bg-[var(--canvas)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {m.type}
                    </span>
                    <span className="font-medium">
                      {m.from.toLowerCase()} → {m.to.toLowerCase()}
                    </span>
                    {m.transport && (
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                        via {m.transport}
                      </span>
                    )}
                    {clock(m.at) && <span className="ml-auto text-[10px] text-[var(--text-muted)]">{clock(m.at)}</span>}
                  </div>
                  {m.detail && <p className="mt-1 text-[var(--text-secondary)]">{m.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {current.items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {current.items.map((item) => (
              <li key={item.id} className="rounded-lg bg-[var(--canvas)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-medium">{item.label}</p>
                  {item.confidence != null && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums">{Math.round(item.confidence * 100)}%</span>
                  )}
                </div>
                {item.detail && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
