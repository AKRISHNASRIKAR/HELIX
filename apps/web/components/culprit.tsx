import type { ReactNode } from 'react';
import { handleInitials, parseCausedBy, type FixStepKind } from '../lib/trace';

/**
 * Shared bits for "Caused by <handle>": the initials avatar, the step-kind
 * icons of a fix plan and a message renderer that turns "Caused by carla.m"
 * inside plain text into an avatar chip. Monochrome on purpose; callers add
 * red only where something broke.
 */

const AVATAR_SIZE = {
  xs: 'h-4 w-4 text-[7px]',
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-14 w-14 text-lg',
} as const;

export function CulpritAvatar({
  handle,
  size = 'md',
  ring = true,
  className = '',
}: {
  handle: string | null | undefined;
  size?: keyof typeof AVATAR_SIZE;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`relative inline-grid shrink-0 select-none place-items-center rounded-full bg-[var(--accent)] font-semibold tracking-wide text-[var(--accent-contrast)] ${ring ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_3px_var(--border-strong)]' : ''} ${AVATAR_SIZE[size]} ${className}`}
    >
      {handleInitials(handle)}
    </span>
  );
}

/** Small monochrome glyph per fix step kind. */
export function FixStepIcon({ kind, className = 'h-4 w-4' }: { kind: FixStepKind; className?: string }) {
  const paths: Record<FixStepKind, ReactNode> = {
    rollback: (
      <>
        <path d="M4 9h11a5 5 0 0 1 0 10H9" />
        <path d="m8 5-4 4 4 4" />
      </>
    ),
    verify: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12.3 2.4 2.4 4.6-5" />
      </>
    ),
    review: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.6-4.6" />
      </>
    ),
    test: (
      <>
        <path d="M9.5 3.5h5M10.5 3.5v5.2L5.4 17.6A2 2 0 0 0 7.1 20.5h9.8a2 2 0 0 0 1.7-2.9l-5.1-8.9V3.5" />
        <path d="M7.6 14h8.8" />
      </>
    ),
    prevent: (
      <>
        <path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z" />
        <path d="m9.3 12 1.9 1.9 3.6-3.8" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[kind]}
    </svg>
  );
}

export const FIX_STEP_LABEL: Record<FixStepKind, string> = {
  rollback: 'Roll back',
  verify: 'Verify',
  review: 'Review',
  test: 'Test',
  prevent: 'Prevent',
};

/**
 * Plain text, except a "Caused by <handle> (...)" part, which becomes an
 * avatar chip with the handle in bold. Anything that does not parse cleanly
 * renders unchanged.
 */
export function CausedByText({ text, className }: { text: string; className?: string }) {
  const parts = parseCausedBy(text);
  if (!parts) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {parts.before}
      <span className="mx-0.5 inline-flex translate-y-[2px] items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] py-0.5 pl-0.5 pr-2 align-baseline text-[0.95em] leading-none text-[var(--text-primary)]">
        <CulpritAvatar handle={parts.handle} size="xs" ring={false} />
        <span>
          <span className="text-[var(--text-muted)]">Caused by </span>
          <strong className="font-semibold">{parts.handle}</strong>
          {parts.detail && <span className="text-[var(--text-secondary)]"> ({parts.detail})</span>}
        </span>
      </span>
      {parts.after}
    </span>
  );
}
