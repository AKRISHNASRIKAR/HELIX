import { InvestigationStatus } from '@helix/types';

const STATUS_CLASSES: Record<InvestigationStatus, string> = {
  [InvestigationStatus.PENDING]: 'bg-slate-100 text-slate-700',
  [InvestigationStatus.PLANNING]: 'bg-blue-100 text-blue-700',
  [InvestigationStatus.IN_PROGRESS]: 'bg-amber-100 text-amber-700',
  [InvestigationStatus.AWAITING_EVIDENCE]: 'bg-amber-100 text-amber-700',
  [InvestigationStatus.COMPLETED]: 'bg-green-100 text-green-700',
  [InvestigationStatus.PARTIALLY_COMPLETED]: 'bg-yellow-100 text-yellow-700',
  [InvestigationStatus.FAILED]: 'bg-red-100 text-red-700',
  [InvestigationStatus.CANCELLED]: 'bg-slate-100 text-slate-500',
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
