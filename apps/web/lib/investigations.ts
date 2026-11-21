import type { Investigation } from '@helix/contracts';
import { InvestigationStatus } from '@helix/types';
import type {
  InvestigationDetail,
  InvestigationRecommendation,
  InvestigationTask,
} from './api';

/** Statuses where the investigation is still open, i.e. not in a terminal state. */
const ACTIVE_STATUSES = new Set<InvestigationStatus>([
  InvestigationStatus.PENDING,
  InvestigationStatus.PLANNING,
  InvestigationStatus.IN_PROGRESS,
  InvestigationStatus.AWAITING_EVIDENCE,
]);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status as InvestigationStatus);
}

export function isActive(investigation: Pick<Investigation, 'status'>): boolean {
  return isActiveStatus(investigation.status);
}

export function countActive(investigations: Investigation[]): number {
  return investigations.filter(isActive).length;
}

/** Formats an API timestamp (Date or ISO string over the wire) for display. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
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

/** Recommendation headline: the API's `title`, or `action` on demo fixtures. */
export function recommendationTitle(r: InvestigationRecommendation): string {
  return r.title ?? r.action ?? 'Untitled recommendation';
}

export interface PlanStepView {
  key: string;
  order: number;
  agentType: string;
  objective: string;
  dependsOn: number[];
  task: InvestigationTask | null;
}

/**
 * Joins persisted plan steps with the agent task that executed each one.
 * Prefers the persisted `steps` (they carry ids that tasks reference) and
 * falls back to the plan JSON when the trail hasn't been written yet.
 */
export function joinStepsWithTasks(detail: InvestigationDetail): PlanStepView[] {
  const tasks = detail.tasks ?? [];
  const steps = detail.steps?.length ? detail.steps : null;
  if (steps) {
    return [...steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        key: s.id,
        order: s.order,
        agentType: s.agentType,
        objective: s.objective,
        dependsOn: s.dependsOn ?? [],
        task: tasks.find((t) => t.investigationStepId === s.id) ?? null,
      }));
  }
  return [...(detail.plan?.steps ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: `plan-${s.order}`,
      order: s.order,
      agentType: s.agentType,
      objective: s.objective,
      dependsOn: s.dependsOn ?? [],
      task: null,
    }));
}

/** Human duration between two timestamps, e.g. "42s", "3m 05s", "1h 12m". */
export function formatDuration(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** "task.failed" -> "Task failed". */
export function formatEventType(type: string): string {
  const words = type.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
