import { AgentTaskStatus, DataSourceStatus } from '@helix/types';

const DATA_SOURCE_CLASSES: Record<DataSourceStatus, string> = {
  [DataSourceStatus.PENDING]: 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]',
  [DataSourceStatus.CONNECTED]: 'bg-[var(--accent)] text-[var(--accent-contrast)]',
  [DataSourceStatus.ERROR]: 'border border-[var(--status-critical)]/40 bg-[var(--anomaly-fill)] text-[var(--text-bad)]',
  [DataSourceStatus.DISABLED]: 'border border-[var(--border)] bg-transparent text-[var(--text-muted)]',
};

const DATA_SOURCE_ICON: Record<DataSourceStatus, string> = {
  [DataSourceStatus.PENDING]: '○',
  [DataSourceStatus.CONNECTED]: '✓',
  [DataSourceStatus.ERROR]: '✕',
  [DataSourceStatus.DISABLED]: '-',
};

/** Status label for a data source; icon + text so it never relies on colour alone. */
export function DataSourceStatusPill({ status }: { status: DataSourceStatus | string }) {
  const key = (status in DATA_SOURCE_CLASSES ? status : DataSourceStatus.PENDING) as DataSourceStatus;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${DATA_SOURCE_CLASSES[key]}`}
    >
      <span aria-hidden>{DATA_SOURCE_ICON[key]}</span>
      {status.toLowerCase()}
    </span>
  );
}

const TASK_CLASSES: Record<AgentTaskStatus, string> = {
  [AgentTaskStatus.QUEUED]: 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]',
  [AgentTaskStatus.RUNNING]: 'helix-shimmer border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]',
  [AgentTaskStatus.SUCCEEDED]: 'bg-[var(--accent)] text-[var(--accent-contrast)]',
  [AgentTaskStatus.FAILED]: 'border border-[var(--status-critical)]/40 bg-[var(--anomaly-fill)] text-[var(--text-bad)]',
  [AgentTaskStatus.TIMED_OUT]: 'border border-[var(--status-critical)]/40 bg-[var(--anomaly-fill)] text-[var(--text-bad)]',
  [AgentTaskStatus.SKIPPED]: 'border border-[var(--border)] bg-transparent text-[var(--text-muted)]',
};

/** Status label for an agent task (plan step execution). */
export function TaskStatusPill({ status }: { status: AgentTaskStatus | string }) {
  const classes = TASK_CLASSES[status as AgentTaskStatus] ?? 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
