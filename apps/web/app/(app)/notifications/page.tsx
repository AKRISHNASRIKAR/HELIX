import Link from 'next/link';
import { getNotifications, isDemoMode } from '../../../lib/api';
import {
  countUnread,
  groupNotificationsByDay,
  notificationTone,
  notificationTypeLabel,
  safeNotificationLink,
} from '../../../lib/notifications';
import { formatDate } from '../../../lib/investigations';
import { formatRelative } from '../../../lib/format';
import { Panel } from '../../../components/panel';
import { EmptyState, Notice, PageHeader, linkClass } from '../../../components/ui';
import { MarkAllReadButton, MarkReadButton } from './notification-actions';

export const metadata = { title: 'Notifications · HELIX' };

const TONE_DOT = {
  good: 'bg-[var(--status-good)]',
  bad: 'bg-[var(--status-critical)]',
  info: 'bg-[var(--series-1)]',
} as const;

export default async function NotificationsPage() {
  const demo = isDemoMode();
  const notifications = await getNotifications();
  const unread = notifications ? countUnread(notifications) : 0;
  const groups = notifications ? groupNotificationsByDay(notifications) : [];

  return (
    <main className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description={
          notifications
            ? `${unread} unread · autonomous investigations and other workspace activity`
            : 'Autonomous investigations and other workspace activity'
        }
        actions={notifications && unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      {demo ? (
        <Notice tone="info">Notifications are not available in demo mode.</Notice>
      ) : notifications === null ? (
        <Notice tone="error">Could not load notifications. Check that the API is running.</Notice>
      ) : notifications.length === 0 ? (
        <Panel>
          <EmptyState title="You're all caught up">
            When a monitor opens an investigation or one finishes, you will be notified here.
          </EmptyState>
        </Panel>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{group.label}</h2>
            <Panel className="!p-0">
              <ul className="divide-y divide-[var(--grid)]">
                {group.items.map((n) => {
                  const link = safeNotificationLink(n.link);
                  const unreadItem = !n.readAt;
                  return (
                    <li key={n.id} className={`flex items-start gap-3 px-5 py-4 ${unreadItem ? '' : 'opacity-75'}`}>
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unreadItem ? TONE_DOT[notificationTone(n.type)] : 'bg-[var(--grid)]'}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                          {notificationTypeLabel(n.type)}
                          {unreadItem && <span className="sr-only"> (unread)</span>}
                        </p>
                        <p className={`mt-0.5 text-sm ${unreadItem ? 'font-semibold' : 'font-medium'}`}>
                          {link ? (
                            <Link href={link} className={`${linkClass} !text-[var(--text-primary)] hover:underline`}>
                              {n.title}
                            </Link>
                          ) : (
                            n.title
                          )}
                        </p>
                        {n.body && <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{n.body}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <time dateTime={n.createdAt} title={formatDate(n.createdAt)} className="text-[11px] text-[var(--text-muted)]">
                          {formatRelative(n.createdAt)}
                        </time>
                        {unreadItem && <MarkReadButton id={n.id} title={n.title} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </section>
        ))
      )}
    </main>
  );
}
