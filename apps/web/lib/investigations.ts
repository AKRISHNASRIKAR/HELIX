import type { Investigation } from '@helix/contracts';
import { InvestigationStatus } from '@helix/types';

/** Statuses where the investigation is still open — i.e. not in a terminal state. */
const ACTIVE_STATUSES = new Set<InvestigationStatus>([
  InvestigationStatus.PENDING,
  InvestigationStatus.PLANNING,
  InvestigationStatus.IN_PROGRESS,
  InvestigationStatus.AWAITING_EVIDENCE,
]);

export function isActive(investigation: Investigation): boolean {
  return ACTIVE_STATUSES.has(investigation.status);
}

export function countActive(investigations: Investigation[]): number {
  return investigations.filter(isActive).length;
}

/** Formats an API timestamp (Date or ISO string over the wire) for display. */
export function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTriggerType(triggerType: string): string {
  return triggerType.replace(/_/g, ' ').toLowerCase();
}
