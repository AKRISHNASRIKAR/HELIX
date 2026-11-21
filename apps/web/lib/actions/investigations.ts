'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '../api';
import { field, type FormState } from './form-state';

export async function createInvestigationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const question = field(formData, 'question');
  const projectId = field(formData, 'projectId');
  const values = { question, projectId };
  if (!projectId) return { error: 'Choose a project.', values };
  if (question.length < 5) return { error: 'Ask a question (at least a few words).', values };

  const res = await apiRequest<{ id: string }>('/investigations', {
    method: 'POST',
    json: { projectId, question },
  });
  if (!res.ok) return { error: res.error, values };
  revalidatePath('/investigations');
  redirect(`/investigations/${res.data.id}`);
}

export async function cancelInvestigationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const res = await apiRequest(`/investigations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: { status: 'CANCELLED' },
  });
  revalidatePath(`/investigations/${id}`);
  if (!res.ok) {
    return { error: res.status === 409 ? 'This investigation has already finished.' : res.error };
  }
  return { success: 'Investigation cancelled.' };
}
