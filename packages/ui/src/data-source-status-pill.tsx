import { AgentTaskStatus, DataSourceStatus } from '@helix/types';

const DATA_SOURCE_CLASSES: Record<DataSourceStatus, string> = {
  [DataSourceStatus.PENDING]: 'bg-slate-100 text-slate-700',
  [DataSourceStatus.CONNECTED]: 'bg-green-100 text-green-700',
  [DataSourceStatus.ERROR]: 'bg-red-100 text-red-700',
  [DataSourceStatus.DISABLED]: 'bg-slate-100 text-slate-500',
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
  [AgentTaskStatus.QUEUED]: 'bg-slate-100 text-slate-700',
  [AgentTaskStatus.RUNNING]: 'bg-blue-100 text-blue-700',
  [AgentTaskStatus.SUCCEEDED]: 'bg-green-100 text-green-700',
  [AgentTaskStatus.FAILED]: 'bg-red-100 text-red-700',
  [AgentTaskStatus.TIMED_OUT]: 'bg-red-100 text-red-700',
  [AgentTaskStatus.SKIPPED]: 'bg-slate-100 text-slate-500',
};

/** Status label for an agent task (plan step execution). */
export function TaskStatusPill({ status }: { status: AgentTaskStatus | string }) {
  const classes = TASK_CLASSES[status as AgentTaskStatus] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
