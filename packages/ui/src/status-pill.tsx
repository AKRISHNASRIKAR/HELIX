import { InvestigationStatus } from '@helix/types';

const STATUS_CLASSES: Record<InvestigationStatus, string> = {
  [InvestigationStatus.PENDING]: 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]',
  [InvestigationStatus.PLANNING]: 'helix-shimmer border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]',
  [InvestigationStatus.IN_PROGRESS]: 'helix-shimmer border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]',
  [InvestigationStatus.AWAITING_EVIDENCE]: 'helix-shimmer border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]',
  [InvestigationStatus.COMPLETED]: 'bg-[var(--accent)] text-[var(--accent-contrast)]',
  [InvestigationStatus.PARTIALLY_COMPLETED]: 'border border-[var(--status-warning)]/40 bg-transparent text-[var(--status-warning)]',
  [InvestigationStatus.FAILED]: 'border border-[var(--status-critical)]/40 bg-[var(--anomaly-fill)] text-[var(--text-bad)]',
  [InvestigationStatus.CANCELLED]: 'border border-[var(--border)] bg-transparent text-[var(--text-muted)]',
};

export interface StatusPillProps {
  status: InvestigationStatus;
}

/** Small colored label used on the dashboard and investigation list/detail views. */
export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? STATUS_CLASSES[InvestigationStatus.PENDING]}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
