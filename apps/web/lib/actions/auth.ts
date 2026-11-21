'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest, getMe, readRequestContext, type Me, type SessionUser } from '../api';
import { resolveActiveMembership, safeNextPath } from '../session';
import { clearSession, setActiveOrg, setSessionToken } from './cookies';
import { field, type FormState } from './form-state';

interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * After a token is issued: pick the active org (keeping the cookie's org if
 * the user still belongs to it) and send new users to onboarding.
 */
async function finishSignIn(token: string, next: string): Promise<never> {
  await setSessionToken(token);
  const me = await apiRequest<Me>('/auth/me', { context: { token }, redirectOn401: false });
  const memberships = me.ok ? me.data.memberships : [];
  if (memberships.length === 0) redirect('/onboarding');

  const current = (await readRequestContext()).organizationId;
  const active = resolveActiveMembership(memberships, current);
  if (active) await setActiveOrg(active.organizationId);
  redirect(safeNextPath(next));
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, 'email');
  const password = typeof formData.get('password') === 'string' ? String(formData.get('password')) : '';
  const values = { email };
  if (!email || !password) return { error: 'Enter your email and password.', values };

  const res = await apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    json: { email, password },
    context: {},
    redirectOn401: false,
  });
  if (!res.ok) {
    return {
      error: res.status === 401 ? 'That email and password combination is not recognized.' : res.error,
      values,
    };
  }
  return finishSignIn(res.data.accessToken, field(formData, 'next'));
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, 'name');
  const email = field(formData, 'email');
  const password = typeof formData.get('password') === 'string' ? String(formData.get('password')) : '';
  const values = { name, email };
  if (!name) return { error: 'Enter your name.', values };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.', values };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.', values };

  const res = await apiRequest<AuthResponse>('/auth/signup', {
    method: 'POST',
    json: { email, name, password },
    context: {},
    redirectOn401: false,
  });
  if (!res.ok) {
    return {
      error: res.status === 409 ? 'An account with that email already exists. Try signing in.' : res.error,
      values,
    };
  }
  return finishSignIn(res.data.accessToken, '/');
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect('/login');
}

/** Sets the active organization (sidebar org switcher). */
export async function switchOrgAction(formData: FormData): Promise<void> {
  const organizationId = field(formData, 'organizationId');
  const me = await getMe();
  if (me && me.memberships.some((m) => m.organizationId === organizationId)) {
    await setActiveOrg(organizationId);
  }
  revalidatePath('/', 'layout');
  // Records on the current page may belong to the previous org.
  redirect('/');
}

/**
 * Onboarding: create an organization (caller becomes OWNER), make it active,
 * then create its first project. If the org was created but the project
 * failed, the org id is echoed back so a retry doesn't create a second org.
 */
export async function onboardingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgName = field(formData, 'organizationName');
  const projectName = field(formData, 'projectName');
  const projectDescription = field(formData, 'projectDescription');
  let organizationId = field(formData, 'organizationId');
  const values = { organizationName: orgName, projectName, projectDescription };

  const { token } = await readRequestContext();
  if (!token) redirect('/login');

  if (!organizationId) {
    if (!orgName) return { error: 'Enter an organization name.', values };
    const org = await apiRequest<{ id: string }>('/organizations', {
      method: 'POST',
      json: { name: orgName },
      context: { token },
    });
    if (!org.ok) return { error: org.error, values };
    organizationId = org.data.id;
    await setActiveOrg(organizationId);
  }

  if (!projectName) return { error: 'Enter a project name.', values, meta: { organizationId } };
  const project = await apiRequest('/projects', {
    method: 'POST',
    json: { name: projectName, description: projectDescription || undefined },
    context: { token, organizationId },
  });
  if (!project.ok) {
    return {
      error: `Organization created, but the project could not be: ${project.error}`,
      values,
      meta: { organizationId },
    };
  }
  revalidatePath('/', 'layout');
  redirect('/');
}
