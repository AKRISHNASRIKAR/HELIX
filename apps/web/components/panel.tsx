import type { ReactNode } from 'react';

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] transition-colors duration-300 hover:border-[var(--border-strong)] ${className}`}
    >
      {title && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const SEVERITY = {
  critical: { color: 'var(--status-critical)', icon: '◆', label: 'Critical' },
  serious: { color: 'var(--status-serious)', icon: '▲', label: 'Serious' },
  warning: { color: 'var(--status-warning)', icon: '●', label: 'Warning' },
} as const;

export function SeverityBadge({ severity }: { severity: keyof typeof SEVERITY }) {
  const s = SEVERITY[severity];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
      <span style={{ color: s.color }} aria-hidden>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}
