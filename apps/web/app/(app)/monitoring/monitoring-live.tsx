'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASE } from '../../../components/motion';
import { PIPELINE_STAGES, pipelineStageForStatus, type PipelineStage } from '../../../lib/monitoring';

/**
 * Shared live state for the monitoring screen: which monitor is running and
 * where its "Run now" sequence is, so the pipeline strip at the top can
 * animate along with the card that is running.
 */

export type LivePhase = 'idle' | 'scanning' | 'found' | 'opening' | 'opened' | 'deduped' | 'clear' | 'limited' | 'error';

interface LiveState {
  monitorName: string | null;
  phase: LivePhase;
  /** Short caption for the current phase (e.g. "CRITICAL drop on Oct 8, 2026"). */
  detail: string | null;
}

interface LiveContext extends LiveState {
  set: (s: LiveState) => void;
}

const Ctx = createContext<LiveContext | null>(null);

export function MonitorLiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ monitorName: null, phase: 'idle', detail: null });
  const value = useMemo(() => ({ ...state, set: setState }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMonitorLive(): LiveContext {
  return useContext(Ctx) ?? { monitorName: null, phase: 'idle', detail: null, set: () => {} };
}

type StageState = 'done' | 'active' | 'alert' | 'pending' | 'skipped';

const STAGE_COPY: Record<PipelineStage, { title: string; caption: string }> = {
  watch: { title: 'Watch', caption: 'Reads the daily metric on a schedule' },
  detect: { title: 'Detect', caption: 'Compares each day to what was expected' },
  investigate: { title: 'Investigate', caption: 'Opens an investigation, agents find why' },
  notify: { title: 'Notify', caption: 'Tells your team with the root cause' },
};

function stageStates(phase: LivePhase, idleReached: PipelineStage): Record<PipelineStage, StageState> {
  const all = (s: StageState): Record<PipelineStage, StageState> => ({ watch: s, detect: s, investigate: s, notify: s });
  switch (phase) {
    case 'scanning':
      return { watch: 'done', detect: 'active', investigate: 'pending', notify: 'pending' };
    case 'found':
      return { watch: 'done', detect: 'alert', investigate: 'pending', notify: 'pending' };
    case 'opening':
      return { watch: 'done', detect: 'alert', investigate: 'active', notify: 'pending' };
    case 'opened':
      return { watch: 'done', detect: 'alert', investigate: 'done', notify: 'active' };
    case 'deduped':
      return { watch: 'done', detect: 'alert', investigate: 'done', notify: 'skipped' };
    case 'limited':
      return { watch: 'done', detect: 'alert', investigate: 'skipped', notify: 'skipped' };
    case 'clear':
      return { watch: 'active', detect: 'done', investigate: 'skipped', notify: 'skipped' };
    case 'error':
      return { ...all('pending'), watch: 'alert' };
    default: {
      const reached = PIPELINE_STAGES.indexOf(idleReached);
      const out = all('pending');
      PIPELINE_STAGES.forEach((s, i) => {
        if (i <= reached) out[s] = 'done';
      });
      out.watch = 'active';
      return out;
    }
  }
}

function phaseCaption(phase: LivePhase, name: string | null, detail: string | null): string {
  const m = name ?? 'the monitor';
  switch (phase) {
    case 'scanning':
      return `Scanning ${m} for anything unusual...`;
    case 'found':
      return `Anomaly caught in ${m}${detail ? `: ${detail}` : ''}`;
    case 'opening':
      return 'Opening an investigation and handing it to the agents';
    case 'opened':
      return 'Investigation running. Your team has been notified.';
    case 'deduped':
      return 'Same anomaly as before, so HELIX reuses the investigation it already opened';
    case 'limited':
      return 'Anomaly caught, but the daily limit of autonomous investigations is reached';
    case 'clear':
      return `All clear: nothing unusual in ${m}`;
    case 'error':
      return detail ?? 'The run failed';
    default:
      return 'Always on: HELIX watches your metrics and acts the moment one breaks';
  }
}

const ICONS: Record<PipelineStage, ReactNode> = {
  watch: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  detect: (
    <>
      <path d="M3 17l5-5 4 4 8-9" />
      <circle cx="20" cy="7" r="1.5" />
    </>
  ),
  investigate: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  notify: <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
};

/** Watch -> Detect -> Investigate -> Notify, animated with the running monitor's state. */
export function PipelineStrip({ idleStatus, idleName }: { idleStatus: string | null; idleName: string | null }) {
  const live = useMonitorLive();
  const reduce = useReducedMotion();
  const states = stageStates(live.phase, pipelineStageForStatus(idleStatus));
  const activeIndex = Math.max(
    0,
    ...PIPELINE_STAGES.map((s, i) => (states[s] === 'active' || states[s] === 'alert' || states[s] === 'done' ? i : 0)),
  );
  const travelling = live.phase !== 'idle';
  const alert = live.phase === 'found' || live.phase === 'limited' || live.phase === 'error';

  return (
    <section
      aria-label="How autonomous monitoring works"
      className={`relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 pb-5 pt-4 shadow-[var(--shadow)] ${travelling ? 'helix-beam' : ''}`}
    >
      <div aria-hidden className="helix-dots pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">How it works</p>
        <motion.p
          key={`${live.phase}-${live.detail}`}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className={`text-xs font-medium ${alert ? 'text-[var(--text-bad)]' : 'text-[var(--text-secondary)]'}`}
          aria-live="polite"
        >
          {phaseCaption(live.phase, live.monitorName ?? idleName, live.detail)}
        </motion.p>
      </div>

      <div className="relative mt-4">
        {/* Rail behind the nodes, with a progress fill and a travelling pulse. */}
        <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-5 h-px bg-[var(--border-strong)]">
          <motion.div
            className={`absolute inset-y-0 left-0 ${alert ? 'bg-[var(--status-critical)]' : 'bg-[var(--accent)]'}`}
            initial={false}
            animate={{ width: `${(activeIndex / (PIPELINE_STAGES.length - 1)) * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}
            style={{ boxShadow: '0 0 12px var(--glow-strong)' }}
          />
          {!reduce && (
            <motion.span
              className={`absolute -top-[3px] h-[7px] w-[7px] rounded-full ${alert ? 'bg-[var(--status-critical)]' : 'bg-[var(--accent)]'}`}
              style={{ boxShadow: '0 0 14px 3px var(--glow-strong)' }}
              animate={{ left: ['0%', `${Math.max(8, (activeIndex / (PIPELINE_STAGES.length - 1)) * 100)}%`], opacity: [0, 1, 1, 0] }}
              transition={{ duration: travelling ? 1.2 : 3.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        <ol className="relative grid grid-cols-4 gap-2">
          {PIPELINE_STAGES.map((stage, i) => {
            const st = states[stage];
            const ring =
              st === 'alert'
                ? 'border-[var(--status-critical)] text-[var(--text-bad)] shadow-[0_0_24px_-2px_var(--status-critical)]'
                : st === 'active'
                  ? 'border-[var(--accent)] text-[var(--text-primary)] shadow-[0_0_24px_-4px_var(--glow-strong)]'
                  : st === 'done'
                    ? 'border-[var(--border-strong)] text-[var(--text-primary)]'
                    : 'border-[var(--border)] text-[var(--text-muted)]';
            return (
              <li key={stage} className={`flex flex-col items-center text-center ${st === 'skipped' ? 'opacity-40' : ''}`}>
                <motion.span
                  className={`relative grid h-10 w-10 place-items-center rounded-full border bg-[var(--surface-raised)] transition-colors ${ring}`}
                  animate={!reduce && (st === 'active' || st === 'alert') ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 1.4, repeat: st === 'active' || st === 'alert' ? Infinity : 0, ease: 'easeInOut' }}
                >
                  {(st === 'active' || st === 'alert') && (
                    <span
                      aria-hidden
                      className="helix-ping absolute inset-0 rounded-full"
                      style={{ background: st === 'alert' ? 'var(--anomaly-fill)' : 'var(--glow)' }}
                    />
                  )}
                  <svg viewBox="0 0 24 24" className="relative h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {ICONS[stage]}
                  </svg>
                </motion.span>
                <p className="mt-2 text-sm font-semibold tracking-tight">
                  <span className="mr-1 text-[var(--text-muted)] tabular-nums">{i + 1}.</span>
                  {STAGE_COPY[stage].title}
                </p>
                <p className="mt-0.5 hidden max-w-[180px] text-[11px] leading-snug text-[var(--text-muted)] sm:block">{STAGE_COPY[stage].caption}</p>
                <span className="sr-only">({st})</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
