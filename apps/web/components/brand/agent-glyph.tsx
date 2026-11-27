/** Stroked 24x24 glyphs per agent type (server safe). */
const GLYPHS: Record<string, string> = {
  // Compass-like: plans and synthesizes.
  COORDINATOR: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8l2.5 4L12 16l-2.5-4z',
  // Bars with a trend.
  ANALYTICS: 'M4 20V10M10 20V4M16 20v-7M22 20H2M4 8l6-4 6 9 4-3',
  // Coin.
  FINANCE: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11',
  // People.
  CUSTOMER: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18.5 14.8c1.6.8 2.6 2.6 3 5.2',
  // Package / release.
  PRODUCT: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
};

const FALLBACK = 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4l3 2';

export function agentGlyph(type: string): string {
  return GLYPHS[type] ?? FALLBACK;
}

export function AgentGlyph({ type, className = 'h-4 w-4', strokeWidth = 1.8 }: { type: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={agentGlyph(type)} />
    </svg>
  );
}
