/**
 * Synthesized UI sound effects (Web Audio, no audio files). Every cue is a
 * short, quiet, monochrome-feeling tone so the demo sounds polished rather
 * than arcade-like. Browsers only allow audio after a user gesture, so the
 * context is created lazily and resumed on the first pointer or key press.
 *
 * Use through `useSound()` (components/experience.tsx), which respects the
 * mute toggle; `playCue` here is the raw engine.
 */

export type Cue =
  | 'click' // buttons, tabs
  | 'hover' // very soft tick on interactive cards
  | 'toggle' // theme / sound switches
  | 'whoosh' // page or panel transitions, data flowing
  | 'launch' // investigation started
  | 'agentStart' // an agent picks up a task
  | 'message' // an A2A message hops between agents
  | 'finding' // an agent reports a finding
  | 'evidence' // an evidence node appears
  | 'rootCause' // the root cause is found (the big moment)
  | 'alert' // monitor caught an anomaly
  | 'notify' // notification arrived
  | 'scan' // monitor sweep tick
  | 'type' // typewriter tick
  | 'success'
  | 'error';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

const MASTER_VOLUME = 1;
/** Per-cue levels below are relative; this lifts them all to a clearly audible level on laptop speakers. */
const CUE_BOOST = 2.6;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      // Gentle compression keeps stacked cues from clipping.
      // Compressor keeps stacked cues from clipping; makeup gain restores loudness after it.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 3;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.8;
      master.connect(comp).connect(makeup).connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  return ctx;
}

/** Call once on mount; resumes the AudioContext on the first user gesture. */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => {
    const c = audio();
    if (c && c.state === 'suspended') void c.resume();
    unlocked = true;
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

export function audioUnlocked(): boolean {
  return unlocked;
}

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  pan?: number;
}

function tone(c: AudioContext, o: ToneOpts) {
  const t0 = c.currentTime + (o.start ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  const peak = Math.min(0.95, (o.gain ?? 0.3) * CUE_BOOST);
  const attack = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let out: AudioNode = g;
  if (o.pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p);
    out = p;
  }
  osc.connect(g);
  out.connect(master!);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

function noise(c: AudioContext, o: { start?: number; dur: number; gain?: number; from: number; to: number; q?: number }) {
  const t0 = c.currentTime + (o.start ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = o.q ?? 1.2;
  bp.frequency.setValueAtTime(o.from, t0);
  bp.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  const g = c.createGain();
  const peak = Math.min(0.95, (o.gain ?? 0.2) * CUE_BOOST);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + o.dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(bp).connect(g).connect(master!);
  src.start(t0);
  src.stop(t0 + o.dur + 0.05);
}

const lastPlayed = new Map<Cue, number>();
/** Minimum gap per cue so bursts (many findings at once) don't turn to noise. */
const THROTTLE_MS: Partial<Record<Cue, number>> = {
  hover: 60,
  type: 35,
  message: 70,
  evidence: 60,
  finding: 120,
  scan: 200,
};

export function playCue(cue: Cue, opts: { pan?: number } = {}): void {
  const c = audio();
  if (!c || !master || c.state !== 'running') return;
  const now = performance.now();
  const gap = THROTTLE_MS[cue];
  if (gap && now - (lastPlayed.get(cue) ?? 0) < gap) return;
  lastPlayed.set(cue, now);
  const pan = opts.pan;

  switch (cue) {
    case 'click':
      tone(c, { freq: 1800, to: 900, type: 'triangle', dur: 0.05, gain: 0.18, pan });
      break;
    case 'hover':
      tone(c, { freq: 2600, type: 'sine', dur: 0.03, gain: 0.04, pan });
      break;
    case 'toggle':
      tone(c, { freq: 660, type: 'triangle', dur: 0.07, gain: 0.16 });
      tone(c, { freq: 990, type: 'triangle', start: 0.06, dur: 0.08, gain: 0.14 });
      break;
    case 'whoosh':
      noise(c, { dur: 0.45, from: 400, to: 3200, gain: 0.12, q: 0.8 });
      break;
    case 'launch':
      noise(c, { dur: 0.7, from: 200, to: 4000, gain: 0.1, q: 0.7 });
      tone(c, { freq: 330, to: 990, type: 'triangle', dur: 0.6, gain: 0.18, attack: 0.05 });
      tone(c, { freq: 440, to: 1320, type: 'triangle', start: 0.1, dur: 0.5, gain: 0.08, attack: 0.05 });
      break;
    case 'agentStart':
      tone(c, { freq: 520, to: 780, type: 'sine', dur: 0.16, gain: 0.16, pan });
      tone(c, { freq: 1560, type: 'sine', start: 0.04, dur: 0.12, gain: 0.05, pan });
      break;
    case 'message':
      tone(c, { freq: 1200, to: 1700, type: 'sine', dur: 0.07, gain: 0.07, pan });
      break;
    case 'finding':
      tone(c, { freq: 784, type: 'sine', dur: 0.22, gain: 0.16, pan });
      tone(c, { freq: 1175, type: 'sine', start: 0.07, dur: 0.25, gain: 0.12, pan });
      break;
    case 'evidence':
      tone(c, { freq: 1400 + Math.random() * 600, type: 'sine', dur: 0.09, gain: 0.06, pan });
      break;
    case 'rootCause': {
      // Low swell, then a bright major chord bloom.
      noise(c, { dur: 1.2, from: 120, to: 2400, gain: 0.08, q: 0.6 });
      tone(c, { freq: 130.81, type: 'triangle', dur: 1.6, gain: 0.22, attack: 0.08 });
      const chord = [261.63, 329.63, 392.0, 523.25, 659.25];
      chord.forEach((f, i) =>
        tone(c, { freq: f, type: i % 2 ? 'triangle' : 'sine', start: 0.25 + i * 0.07, dur: 1.6, gain: 0.11, attack: 0.03 }),
      );
      tone(c, { freq: 1046.5, type: 'sine', start: 0.65, dur: 1.2, gain: 0.07 });
      break;
    }
    case 'alert':
      tone(c, { freq: 880, type: 'square', dur: 0.12, gain: 0.07 });
      tone(c, { freq: 660, type: 'square', start: 0.16, dur: 0.12, gain: 0.07 });
      tone(c, { freq: 880, type: 'square', start: 0.32, dur: 0.12, gain: 0.07 });
      tone(c, { freq: 220, type: 'triangle', dur: 0.5, gain: 0.16 });
      break;
    case 'notify':
      tone(c, { freq: 1318.5, type: 'sine', dur: 0.18, gain: 0.12 });
      tone(c, { freq: 1760, type: 'sine', start: 0.09, dur: 0.3, gain: 0.1 });
      break;
    case 'scan':
      tone(c, { freq: 300, to: 1200, type: 'sine', dur: 0.35, gain: 0.05, attack: 0.1 });
      break;
    case 'type':
      tone(c, { freq: 3000 + Math.random() * 800, type: 'square', dur: 0.012, gain: 0.025 });
      break;
    case 'success':
      tone(c, { freq: 523.25, type: 'sine', dur: 0.15, gain: 0.14 });
      tone(c, { freq: 783.99, type: 'sine', start: 0.1, dur: 0.25, gain: 0.14 });
      break;
    case 'error':
      tone(c, { freq: 300, to: 180, type: 'sawtooth', dur: 0.3, gain: 0.08 });
      break;
  }
}
