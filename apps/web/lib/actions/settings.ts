'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, readRequestContext } from '../api';
import { field, type FormState } from './form-state';

const ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, 'name');
  const description = field(formData, 'description');
  if (!name) return { error: 'Enter a project name.', values: { name, description } };

  const res = await apiRequest('/projects', {
    method: 'POST',
    json: { name, description: description || undefined },
  });
  if (!res.ok) return { error: res.error, values: { name, description } };
  revalidatePath('/settings');
  revalidatePath('/investigations');
  return { success: `Project "${name}" created.` };
}

export async function addMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, 'email');
  const role = field(formData, 'role') || 'MEMBER';
  const values = { email, role };
  if (!email) return { error: 'Enter the email of an existing HELIX user.', values };
  if (!ROLES.has(role)) return { error: 'Choose a valid role.', values };

  const { organizationId } = await readRequestContext();
  if (!organizationId) return { error: 'No active organization.', values };
  const res = await apiRequest(`/organizations/${encodeURIComponent(organizationId)}/members`, {
    method: 'POST',
    json: { email, role },
  });
  if (!res.ok) {
    return {
      error: res.status === 404 ? 'No HELIX account uses that email. Ask them to sign up first.' : res.error,
      values,
    };
  }
  revalidatePath('/settings');
  return { success: `${email} added as ${role.toLowerCase()}.` };
}
