'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { installAudioUnlock, playCue, type Cue } from '../lib/sound';

/**
 * App-wide "experience" state: theme (dark/light) and sound (on/muted).
 * Both persist per viewer in localStorage; every access is wrapped because
 * storage can be blocked. Theme is applied as <html data-theme>, which the
 * inline script in app/layout.tsx also sets before first paint.
 */

export type Theme = 'dark' | 'light';

interface Experience {
  theme: Theme;
  setTheme: (t: Theme) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  play: (cue: Cue, opts?: { pan?: number }) => void;
}

const ExperienceContext = createContext<Experience | null>(null);

export const THEME_KEY = 'helix-theme';
const MUTE_KEY = 'helix-muted';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: setting just won't persist */
  }
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') setThemeState(t);
    setMutedState(read(MUTE_KEY) === '1');
    return installAudioUnlock();
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    write(THEME_KEY, t);
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    write(MUTE_KEY, m ? '1' : '0');
  }, []);

  const play = useCallback(
    (cue: Cue, opts?: { pan?: number }) => {
      if (!muted) playCue(cue, opts);
    },
    [muted],
  );

  const value = useMemo(() => ({ theme, setTheme, muted, setMuted, play }), [theme, setTheme, muted, setMuted, play]);
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

const NOOP: Experience = {
  theme: 'dark',
  setTheme: () => {},
  muted: true,
  setMuted: () => {},
  play: () => {},
};

export function useExperience(): Experience {
  return useContext(ExperienceContext) ?? NOOP;
}

/** `const play = useSound(); play('finding')`. Silent when muted. */
export function useSound() {
  return useExperience().play;
}

/** Plays a cue whenever `key` changes (skips the first render). */
export function useCueOnChange(cue: Cue, key: unknown) {
  const play = useSound();
  const [prev, setPrev] = useState(key);
  useEffect(() => {
    if (key !== prev) {
      setPrev(key);
      play(cue);
    }
  }, [key, prev, cue, play]);
}

const toggleClass =
  'grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-all hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:scale-95';

export function ThemeToggle() {
  const { theme, setTheme, play } = useExperience();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={toggleClass}
      onClick={() => {
        setTheme(next);
        play('toggle');
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function SoundToggle() {
  const { muted, setMuted, play } = useExperience();
  return (
    <button
      type="button"
      className={toggleClass}
      onClick={() => {
        setMuted(!muted);
        // Confirm unmuting audibly (play() still sees the old muted value).
        if (muted) playCue('toggle');
      }}
      aria-label={muted ? 'Turn sound on' : 'Mute sound'}
      aria-pressed={!muted}
      title={muted ? 'Sound off' : 'Sound on'}
      onMouseEnter={() => play('hover')}
    >
      {muted ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="m23 9-6 6M17 9l6 6" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        </svg>
      )}
    </button>
  );
}

/**
 * Plays a soft click for any <a>/<button> click and a whoosh on route change,
 * so every page gets baseline sound without wiring each control.
 */
export function GlobalSounds() {
  const play = useSound();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('a,button,[role="tab"],summary');
      if (el && !el.hasAttribute('data-silent')) play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [play]);
  return null;
}
