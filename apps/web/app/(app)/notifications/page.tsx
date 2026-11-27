import { getNotifications, isDemoMode } from '../../../lib/api';
import { countUnread, groupNotificationsByDay, notificationKind } from '../../../lib/notifications';
import { Panel } from '../../../components/panel';
import { CountUp, LiveDot, Stagger } from '../../../components/motion';
import { EmptyState, Notice, PageHeader } from '../../../components/ui';
import { MarkAllReadButton } from './notification-actions';
import { NotificationFeed } from './notification-feed';

export const metadata = { title: 'Notifications · HELIX' };

export default async function NotificationsPage() {
  const demo = isDemoMode();
  const notifications = await getNotifications();
  const unread = notifications ? countUnread(notifications) : 0;
  const groups = notifications ? groupNotificationsByDay(notifications) : [];

  const kinds = notifications ? notifications.map((n) => notificationKind(n.type)) : [];
  const tiles = [
    { label: 'Unread', value: unread, live: unread > 0 },
    { label: 'Opened by monitors', value: kinds.filter((k) => k === 'opened').length },
    { label: 'Completed', value: kinds.filter((k) => k === 'completed').length },
    { label: 'Failed', value: kinds.filter((k) => k === 'failed').length, bad: true },
  ];

  return (
    <main className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="HELIX tells you the moment a monitor opens an investigation, and again when the root cause is in."
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
        <>
          <Stagger as="section" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <Panel key={t.label} className="!p-4">
                <p className="flex items-center gap-2 text-[11px] font-medium text-[var(--text-secondary)]">
                  {t.live && <LiveDot tone="bad" />}
                  {t.label}
                </p>
                <p className={`mt-2 text-3xl font-semibold leading-none tracking-tight ${t.bad && t.value > 0 ? 'text-[var(--text-bad)]' : ''}`}>
                  <CountUp value={t.value} />
                </p>
              </Panel>
            ))}
          </Stagger>
          <NotificationFeed groups={groups} />
        </>
      )}
    </main>
  );
}
