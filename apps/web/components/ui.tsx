import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Small server-safe primitives shared by forms and pages. Colours come from
 * the CSS tokens in globals.css, matching Panel and the dashboard.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[#0b0b0b] text-white hover:bg-[#2b2b2b]',
  secondary:
    'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--canvas)]',
  danger: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-bad)] hover:bg-[#fdf1f1]',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--canvas)] hover:text-[var(--text-primary)]',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: 'sm' | 'md' = 'sm'): string {
  const sizing = size === 'sm' ? 'px-3.5 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON_VARIANTS[variant]} ${FOCUS}`;
}

export const inputClass = `block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors hover:border-[#d4d3cd] disabled:opacity-60 ${FOCUS}`;

export const linkClass = `rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`;

/** Label + control + optional hint, wired with htmlFor/aria-describedby. */
export function Field({
  id,
  label,
  hint,
  children,
  className = '',
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[11px] text-[var(--text-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-[#f1c9c9] bg-[#fdf3f3] text-[var(--text-bad)]',
    success: 'border-[#c6e6c6] bg-[#f2faf2] text-[var(--text-good)]',
    info: 'border-[var(--border)] bg-[var(--canvas)] text-[var(--text-secondary)]',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-[13px] ${styles}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Centered empty state with an optional call to action. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] text-[var(--text-muted)]">{children}</div>}
      {action && (
        <Link href={action.href} className={`mt-4 ${buttonClass('primary')}`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Thin confidence bar + percentage. */
export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden>
        <span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs font-semibold tabular-nums">{pct}%</span>
    </span>
  );
}
