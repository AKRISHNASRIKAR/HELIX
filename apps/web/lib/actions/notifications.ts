'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '../api';
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
