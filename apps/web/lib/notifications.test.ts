import { describe, expect, it } from 'vitest';
import {
  countUnread,
  groupNotificationsByDay,
  notificationTone,
  notificationTypeLabel,
  safeNotificationLink,
  unreadBadge,
  newerThan,
  newestAt,
  notificationHref,
  notificationKind,
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

describe('notificationKind / notificationHref', () => {
  it('classifies types', () => {
    expect(notificationKind('investigation.autonomous_opened')).toBe('opened');
    expect(notificationKind('investigation.completed')).toBe('completed');
    expect(notificationKind('investigation.autonomous_failed')).toBe('failed');
    expect(notificationKind('member.added')).toBe('other');
  });

  it('sends just-opened investigations to the live playback', () => {
    expect(notificationHref({ type: 'investigation.autonomous_opened', link: '/investigations/abc' })).toBe(
      '/investigations/abc?play=1',
    );
    expect(notificationHref({ type: 'investigation.completed', link: '/investigations/abc' })).toBe('/investigations/abc');
    expect(notificationHref({ type: 'investigation.autonomous_opened', link: 'https://evil.test' })).toBeNull();
    expect(notificationHref({ type: 'investigation.autonomous_opened', link: '/investigations/abc?x=1' })).toBe(
      '/investigations/abc?x=1',
    );
  });
});

describe('newerThan / newestAt', () => {
  const list = [
    { id: 'a', createdAt: '2026-11-27T10:00:00.000Z' },
    { id: 'b', createdAt: '2026-11-27T12:00:00.000Z' },
    { id: 'c', createdAt: '2026-11-27T11:00:00.000Z' },
  ];
  it('keeps only newer items, newest first', () => {
    expect(newerThan(list, '2026-11-27T10:00:00.000Z').map((n) => n.id)).toEqual(['b', 'c']);
    expect(newerThan(list, null).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
  it('finds the newest timestamp', () => {
    expect(newestAt(list)).toBe('2026-11-27T12:00:00.000Z');
    expect(newestAt([])).toBeNull();
  });
});
