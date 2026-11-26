import { describe, expect, it } from 'vitest';
import {
  countUnread,
  groupNotificationsByDay,
  notificationTone,
  notificationTypeLabel,
  safeNotificationLink,
  unreadBadge,
} from './notifications';

describe('notificationTypeLabel', () => {
  it('names known types', () => {
    expect(notificationTypeLabel('investigation.autonomous_completed')).toBe('Autonomous investigation completed');
    expect(notificationTypeLabel('investigation.autonomous_opened')).toBe('Autonomous investigation opened');
  });
  it('humanizes unknown types', () => {
    expect(notificationTypeLabel('monitor.run_failed')).toBe('Monitor run failed');
    expect(notificationTypeLabel('')).toBe('Notification');
  });
});

describe('notificationTone', () => {
  it('maps outcomes to tones', () => {
    expect(notificationTone('investigation.autonomous_failed')).toBe('bad');
    expect(notificationTone('investigation.autonomous_completed')).toBe('good');
    expect(notificationTone('investigation.autonomous_opened')).toBe('info');
  });
});

describe('safeNotificationLink', () => {
  it('only allows same-origin paths', () => {
    expect(safeNotificationLink('/investigations/abc')).toBe('/investigations/abc');
    expect(safeNotificationLink('https://evil.example')).toBeNull();
    expect(safeNotificationLink('//evil.example')).toBeNull();
    expect(safeNotificationLink('/\\evil')).toBeNull();
    expect(safeNotificationLink(null)).toBeNull();
  });
});

describe('unreadBadge / countUnread', () => {
  it('hides zero and caps large counts', () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(null)).toBeNull();
    expect(unreadBadge(7)).toBe('7');
    expect(unreadBadge(150)).toBe('99+');
  });
  it('counts unread items', () => {
    expect(countUnread([{ readAt: null }, { readAt: '2026-11-26T00:00:00Z' }, { readAt: null }])).toBe(2);
  });
});

describe('groupNotificationsByDay', () => {
  it('groups consecutive items by UTC day with friendly labels', () => {
    const now = new Date('2026-11-26T15:00:00Z');
    const groups = groupNotificationsByDay(
      [
        { id: 'a', createdAt: '2026-11-26T14:00:00Z' },
        { id: 'b', createdAt: '2026-11-26T01:00:00Z' },
        { id: 'c', createdAt: '2026-11-25T09:00:00Z' },
        { id: 'd', createdAt: '2026-10-08T09:00:00Z' },
        { id: 'e', createdAt: 'not a date' },
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Oct 8, 2026', ['d']],
      ['Earlier', ['e']],
    ]);
  });
});
