import type { AppNotification } from './api';

/** Pure notification formatting helpers (tested in lib/notifications.test.ts). */

const TYPE_LABEL: Record<string, string> = {
  'investigation.autonomous_opened': 'Autonomous investigation opened',
  'investigation.autonomous_completed': 'Autonomous investigation completed',
  'investigation.autonomous_failed': 'Autonomous investigation failed',
  'investigation.completed': 'Investigation completed',
  'investigation.failed': 'Investigation failed',
};

/** "investigation.autonomous_completed" -> "Autonomous investigation completed". */
export function notificationTypeLabel(type: string): string {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type];
  const words = type.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Notification';
}

export type NotificationTone = 'good' | 'bad' | 'info';

export function notificationTone(type: string): NotificationTone {
  if (/(failed|error)$/.test(type)) return 'bad';
  if (/(completed|succeeded)$/.test(type)) return 'good';
  return 'info';
}

/** Only same-origin app paths are rendered as links. */
export function safeNotificationLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.startsWith('/\\')) return null;
  return link;
}

/** Bell badge text: hidden at 0, capped at "99+". */
export function unreadBadge(count: number | null | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

export function countUnread(list: Pick<AppNotification, 'readAt'>[]): number {
  return list.filter((n) => !n.readAt).length;
}

/** Groups notifications (already newest first) under "Today", "Yesterday" or a date label. */
export function groupNotificationsByDay<T extends Pick<AppNotification, 'createdAt'>>(
  list: T[],
  now = new Date(),
): { label: string; items: T[] }[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const groups: { label: string; items: T[] }[] = [];
  for (const n of list) {
    const date = new Date(n.createdAt);
    const key = Number.isNaN(date.getTime()) ? 'unknown' : dayKey(date);
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : key === 'unknown'
            ? 'Earlier'
            : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

export type NotificationKind = 'opened' | 'completed' | 'failed' | 'other';

/** Drives the feed / toast glyph. */
export function notificationKind(type: string): NotificationKind {
  if (/(failed|error)$/.test(type)) return 'failed';
  if (/(completed|succeeded)$/.test(type)) return 'completed';
  if (/opened$/.test(type)) return 'opened';
  return 'other';
}

/**
 * Where a toast/feed item should go. A just-opened investigation links to the
 * live playback (`?play=1`) so the audience can watch it run.
 */
export function notificationHref(n: Pick<AppNotification, 'type' | 'link'>): string | null {
  const link = safeNotificationLink(n.link);
  if (!link) return null;
  if (notificationKind(n.type) === 'opened' && /^\/investigations\/[^/?#]+$/.test(link)) return `${link}?play=1`;
  return link;
}

/** Notifications strictly newer than `since` (ISO), newest first. All of them when `since` is null. */
export function newerThan<T extends Pick<AppNotification, 'createdAt'>>(list: T[], since: string | null): T[] {
  const t = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  return list
    .filter((n) => Date.parse(n.createdAt) > t)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Newest createdAt in a list, or null. */
export function newestAt(list: Pick<AppNotification, 'createdAt'>[]): string | null {
  let best: string | null = null;
  for (const n of list) if (!best || Date.parse(n.createdAt) > Date.parse(best)) best = n.createdAt;
  return best;
}
