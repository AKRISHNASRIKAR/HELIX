import { describe, expect, it } from 'vitest';
import type { InvestigationDetail } from './api';
import {
  formatDate,
  formatDuration,
  formatEventType,
  isActiveStatus,
  joinStepsWithTasks,
  recommendationTitle,
} from './investigations';

const base = {
  id: 'inv',
  organizationId: 'o',
  projectId: 'p',
  createdByUserId: null,
  triggerType: 'USER_QUESTION',
  question: 'q',
  status: 'COMPLETED',
  plan: null,
  rootCauseFindingId: null,
  summary: null,
  overallConfidence: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as InvestigationDetail;

describe('isActiveStatus', () => {
  it('treats non-terminal statuses as active', () => {
    expect(isActiveStatus('PENDING')).toBe(true);
    expect(isActiveStatus('IN_PROGRESS')).toBe(true);
    expect(isActiveStatus('COMPLETED')).toBe(false);
    expect(isActiveStatus('CANCELLED')).toBe(false);
  });
});

describe('joinStepsWithTasks', () => {
  it('attaches the task that ran each persisted step, ordered by step order', () => {
    const detail: InvestigationDetail = {
      ...base,
      steps: [
        { id: 's2', order: 2, agentType: 'FINANCE', objective: 'b', dependsOn: [1] },
        { id: 's1', order: 1, agentType: 'ANALYTICS', objective: 'a', dependsOn: [] },
      ],
      tasks: [
        {
          id: 't1',
          agentType: 'ANALYTICS',
          status: 'FAILED',
          objective: 'a',
          error: 'boom',
          startedAt: null,
          completedAt: null,
          investigationStepId: 's1',
        },
      ],
    };
    const view = joinStepsWithTasks(detail);
    expect(view.map((s) => s.key)).toEqual(['s1', 's2']);
    expect(view[0]!.task?.error).toBe('boom');
    expect(view[1]!.task).toBeNull();
  });

  it('falls back to plan steps when no steps are persisted', () => {
    const detail = {
      ...base,
      plan: { steps: [{ order: 1, agentType: 'ANALYTICS', objective: 'x', dependsOn: [] }] },
    } as InvestigationDetail;
    expect(joinStepsWithTasks(detail)).toEqual([
      { key: 'plan-1', order: 1, agentType: 'ANALYTICS', objective: 'x', dependsOn: [], task: null },
    ]);
  });

  it('returns [] with neither steps nor plan', () => {
    expect(joinStepsWithTasks(base)).toEqual([]);
  });
});

describe('recommendationTitle', () => {
  it('prefers title, falls back to action', () => {
    expect(recommendationTitle({ priority: 'LOW', title: 'T', action: 'A', expectedImpact: null })).toBe('T');
    expect(recommendationTitle({ priority: 'LOW', action: 'A', expectedImpact: null })).toBe('A');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    const t0 = '2026-10-14T09:00:00Z';
    expect(formatDuration(t0, '2026-10-14T09:00:42Z')).toBe('42s');
    expect(formatDuration(t0, '2026-10-14T09:03:05Z')).toBe('3m 05s');
    expect(formatDuration(t0, '2026-10-14T10:12:00Z')).toBe('1h 12m');
    expect(formatDuration(null, t0)).toBeNull();
    expect(formatDuration('2026-10-14T10:00:00Z', t0)).toBeNull();
  });
});

describe('formatEventType', () => {
  it('humanizes dotted event types', () => {
    expect(formatEventType('task.failed')).toBe('Task failed');
    expect(formatEventType('investigation.plan_produced')).toBe('Investigation plan produced');
  });
});

describe('formatDate', () => {
  it('renders a hyphen for missing or invalid values', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate('nope')).toBe('-');
  });
});
