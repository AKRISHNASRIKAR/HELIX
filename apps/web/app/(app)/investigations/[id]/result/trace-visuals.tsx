'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { agentLabel, type SequenceArrow, type SnapshotBudget, type SnapshotDecision } from '../../../../../lib/trace';
import { useSound } from '../../../../../components/experience';
import { EASE, Stagger, motion } from '../../../../../components/motion';

const VIEW = { once: true, margin: '-40px' } as const;

/** Tokens used against the context engine's budget, filling when visible. */
export function BudgetBar({ budget }: { budget: SnapshotBudget }) {
  const reduce = useReducedMotion();
  const { used, budget: cap, before } = budget;
  if (used == null) return <p className="text-xs text-[var(--text-muted)]">Token count unknown</p>;
  const scale = Math.max(cap ?? used, before ?? 0, used) || 1;
  const pct = (used / scale) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-[var(--text-muted)]">Context size</span>
        <span className="tabular-nums">
          <span className="text-base font-semibold text-[var(--text-primary)]">{used.toLocaleString('en-US')}</span>
          {cap != null && <span className="text-[var(--text-muted)]"> / {cap.toLocaleString('en-US')} tokens</span>}
          {cap == null && <span className="text-[var(--text-muted)]"> tokens</span>}
        </span>
      </div>
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--grid)]">
        {before != null && (
          <motion.span
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--band)] ring-1 ring-inset ring-[var(--border-strong)]"
            initial={reduce ? false : { width: 0 }}
            whileInView={{ width: `${(before / scale) * 100}%` }}
            viewport={VIEW}
            transition={{ duration: 0.8, ease: EASE }}
            title={`${before.toLocaleString('en-US')} tokens before trimming`}
          />
        )}
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--glow-strong)]"
          initial={reduce ? false : { width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={VIEW}
          transition={{ duration: 1.1, ease: EASE, delay: before != null ? 0.6 : 0.1 }}
        />
        {cap != null && <span className="absolute inset-y-0 w-0.5 bg-[var(--text-primary)]" style={{ left: `${(cap / scale) * 100}%` }} aria-hidden />}
      </div>
      {before != null && (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Trimmed from {before.toLocaleString('en-US')} tokens
          {budget.dropped.length > 0 && <>: dropped {budget.dropped.join(', ')}</>}
        </p>
      )}
    </div>
  );
}

/** The context engine's decisions as a vertical, numbered list that staggers in. */
export function DecisionList({ decisions }: { decisions: SnapshotDecision[] }) {
  if (decisions.length === 0) return <p className="text-xs text-[var(--text-muted)]">No decisions recorded.</p>;
  return (
    <Stagger as="ol" className="relative space-y-2 border-l border-[var(--border-strong)] pl-4" step={0.07}>
      {decisions.map((d, i) => (
        <div key={`${d.rule}-${i}`} className="relative">
          <span className="absolute -left-[23px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--accent)] text-[8px] font-bold text-[var(--accent-contrast)]">
            {i + 1}
          </span>
          <p className="text-xs">
            <span className="font-mono font-semibold">{d.rule.replace(/_/g, ' ')}</span>
            {d.reason && <span className="text-[var(--text-secondary)]">: {d.reason}</span>}
          </p>
          {(d.kept.length > 0 || d.dropped.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.kept.map((k) => (
                <span key={`k-${k}`} className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-[var(--border)]">
                  ✓ {k}
                </span>
              ))}
              {d.dropped.map((k) => (
                <span key={`d-${k}`} className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] line-through border border-dashed border-[var(--border-strong)]">
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </Stagger>
  );
}

/**
 * A2A messages as a sequence diagram: one lifeline per agent, one arrow per
 * message in time order, drawn in one after another with a `message` cue.
 */
export function SequenceDiagram({ lanes, arrows }: { lanes: string[]; arrows: SequenceArrow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const play = useSound();
  const [shown, setShown] = useState(0);
  const STEP = 380;

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(arrows.length);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= arrows.length) window.clearInterval(id);
    }, STEP);
    return () => window.clearInterval(id);
  }, [inView, reduce, arrows.length]);

  useEffect(() => {
    if (shown === 0 || reduce) return;
    const a = arrows[shown - 1];
    if (!a) return;
    const li = lanes.indexOf(a.to);
    play('message', { pan: lanes.length > 1 ? -0.6 + (1.2 * li) / (lanes.length - 1) : 0 });
    // Keyed on `shown`: one cue per arrow as it appears.
  }, [shown]);

  if (arrows.length === 0) return <p className="text-sm text-[var(--text-muted)]">No A2A messages recorded.</p>;
  const W = 900;
  const top = 44;
  const rowH = 46;
  const H = top + arrows.length * rowH + 16;
  const laneX = (l: string) => 70 + (lanes.indexOf(l) * (W - 140)) / Math.max(1, lanes.length - 1);

  return (
    <div ref={ref} className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[640px]" role="img" aria-label={`${arrows.length} A2A messages between ${lanes.map(agentLabel).join(', ')}`}>
        <defs>
          <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-primary)" />
          </marker>
          <marker id="seq-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--status-critical)" />
          </marker>
        </defs>
        {lanes.map((l) => (
          <g key={l}>
            <rect x={laneX(l) - 52} y={4} width={104} height={26} rx={8} fill={l === 'COORDINATOR' ? 'var(--accent)' : 'var(--surface-2)'} stroke="var(--border-strong)" />
            <text x={laneX(l)} y={21} textAnchor="middle" fontSize={12} fontWeight={600} fill={l === 'COORDINATOR' ? 'var(--accent-contrast)' : 'var(--text-primary)'}>
              {agentLabel(l)}
            </text>
            <line x1={laneX(l)} x2={laneX(l)} y1={30} y2={H} stroke="var(--border-strong)" strokeDasharray="3 5" />
          </g>
        ))}
        {arrows.map((a, i) => {
          if (i >= shown) return null;
          const y = top + i * rowH + 22;
          const x1 = laneX(a.from);
          const x2 = laneX(a.to);
          const dir = x2 >= x1 ? 1 : -1;
          const bad = a.type === 'ERROR';
          const mid = (x1 + x2) / 2;
          return (
            <g key={a.id}>
              <motion.line
                x1={x1}
                y1={y}
                x2={x2 - dir * 4}
                y2={y}
                stroke={bad ? 'var(--status-critical)' : 'var(--text-primary)'}
                strokeWidth={1.6}
                strokeDasharray={a.type === 'TASK_RESULT' ? '5 4' : undefined}
                markerEnd={`url(#${bad ? 'seq-arrow-bad' : 'seq-arrow'})`}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.45, ease: EASE }}
              />
              <circle cx={x1} cy={y} r={3} fill={bad ? 'var(--status-critical)' : 'var(--text-primary)'} />
              <motion.g initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
                <text x={mid} y={y - 7} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={bad ? 'var(--text-bad)' : 'var(--text-primary)'} className="font-mono">
                  {a.type}
                  {a.detail ? `  ${a.detail.length > 34 ? `${a.detail.slice(0, 33)}...` : a.detail}` : ''}
                </text>
                <text x={mid} y={y + 14} textAnchor="middle" fontSize={9.5} fill="var(--text-muted)">
                  {[a.transport ? `via ${a.transport}` : null, `+${a.offsetMs}ms`].filter(Boolean).join('  ·  ')}
                </text>
              </motion.g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
