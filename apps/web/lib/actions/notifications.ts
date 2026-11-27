'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, isDemoMode, readRequestContext, type AppNotification } from '../api';
import { newerThan, newestAt } from '../notifications';
import { field, type FormState } from './form-state';

export async function markNotificationReadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  if (!id) return { error: 'Missing notification.' };
  const res = await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  // The bell lives in the layout, so refresh the whole tree.
  revalidatePath('/', 'layout');
  if (!res.ok) return { error: res.error };
  return { success: 'Marked as read.' };
}

export async function markAllNotificationsReadAction(_prev: FormState): Promise<FormState> {
  const res = await apiRequest('/notifications/read-all', { method: 'POST' });
  revalidatePath('/', 'layout');
  if (!res.ok) return { error: res.error };
  return { success: 'All notifications marked as read.' };
}

export interface NotificationPoll {
  count: number;
  /** Newest unread createdAt seen so far (the baseline for the next poll). */
  newestAt: string | null;
  /** Unread notifications that arrived since the previous poll, newest first. */
  fresh: AppNotification[];
}

/**
 * Polled by the global toaster. Cheap when nothing changed (one unread-count
 * call); fetches the unread list only when the count went up. The first poll
 * (prev null) only sets the baseline, so existing notifications never toast.
 */
export async function pollNotifications(
  prev: { count: number; newestAt: string | null } | null,
): Promise<NotificationPoll | null> {
  if (isDemoMode()) return null;
  const ctx = await readRequestContext();
  if (!ctx.token) return null;
  const res = await apiRequest<{ count: number }>('/notifications/unread-count', { redirectOn401: false });
  if (!res.ok || typeof res.data?.count !== 'number') return null;
  const count = res.data.count;
  if (prev && count <= prev.count) return { count, newestAt: prev.newestAt, fresh: [] };

  const list = await apiRequest<AppNotification[]>('/notifications?unread=true', { redirectOn401: false });
  if (!list.ok || !Array.isArray(list.data)) return { count, newestAt: prev?.newestAt ?? null, fresh: [] };
  const newest = newestAt(list.data);
  const baseline = prev?.newestAt ?? null;
  const fresh = prev ? newerThan(list.data, baseline).slice(0, 3) : [];
  const keep = baseline && newest && Date.parse(baseline) > Date.parse(newest) ? baseline : (newest ?? baseline);
  return { count, newestAt: keep, fresh };
}
