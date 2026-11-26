'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '../api';
import { field, type FormState } from './form-state';

const MAX_CSV_BYTES = 50 * 1024 * 1024;

/** Connect a Postgres data source. The API discovers the schema synchronously. */
export async function createPostgresSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    name: field(formData, 'name'),
    host: field(formData, 'host'),
    port: field(formData, 'port') || '5432',
    database: field(formData, 'database'),
    schema: field(formData, 'schema') || 'public',
    user: field(formData, 'user'),
  };
  // Password is never echoed back to the form.
  const password = typeof formData.get('password') === 'string' ? String(formData.get('password')) : '';

  const missing = (['name', 'host', 'database', 'user'] as const).filter((k) => !values[k]);
  if (missing.length > 0) return { error: `Fill in: ${missing.join(', ')}.`, values };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Port must be a whole number between 1 and 65535.', values };
  }

  const res = await apiRequest<{ id: string }>('/data-sources', {
    method: 'POST',
    json: {
      name: values.name,
      type: 'POSTGRESQL',
      config: { host: values.host, port, database: values.database, schema: values.schema },
      credentials: { user: values.user, password },
    },
  });
  if (!res.ok) return { error: res.error, values };
  revalidatePath('/data-sources');
  redirect(`/data-sources/${res.data.id}`);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Connect an MCP server (streamable HTTP). Its list_* tools become tables. */
export async function createMcpSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { name: field(formData, 'name'), serverUrl: field(formData, 'serverUrl') };
  // The token is never echoed back to the form.
  const token = field(formData, 'token');
  if (!values.name) return { error: 'Give the source a display name.', values };
  if (!isHttpUrl(values.serverUrl)) return { error: 'Server URL must be an http(s) URL, for example http://localhost:8006/mcp.', values };

  const res = await apiRequest<{ id: string }>('/data-sources', {
    method: 'POST',
    json: {
      name: values.name,
      type: 'MCP',
      config: { serverUrl: values.serverUrl, transport: 'streamable_http' },
      ...(token ? { credentials: { token } } : {}),
    },
  });
  if (!res.ok) return { error: res.error, values };
  revalidatePath('/data-sources');
  redirect(`/data-sources/${res.data.id}`);
}

/** Connect a GitHub repository (deployments, releases, commits tables). */
export async function createGithubSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    name: field(formData, 'name'),
    owner: field(formData, 'owner'),
    repo: field(formData, 'repo'),
    apiUrl: field(formData, 'apiUrl'),
  };
  const token = field(formData, 'token');
  const missing = (['name', 'owner', 'repo'] as const).filter((k) => !values[k]);
  if (missing.length > 0) return { error: `Fill in: ${missing.join(', ')}.`, values };
  if (!token) return { error: 'A GitHub token is required.', values };
  if (values.apiUrl && !isHttpUrl(values.apiUrl)) return { error: 'API URL must be an http(s) URL.', values };

  const res = await apiRequest<{ id: string }>('/data-sources', {
    method: 'POST',
    json: {
      name: values.name,
      type: 'GITHUB',
      config: { owner: values.owner, repo: values.repo, ...(values.apiUrl ? { apiUrl: values.apiUrl } : {}) },
      credentials: { token },
    },
  });
  if (!res.ok) return { error: res.error, values };
  revalidatePath('/data-sources');
  redirect(`/data-sources/${res.data.id}`);
}

/** Upload a CSV: forwards the multipart body (file + name) to the API with auth. */
export async function uploadCsvSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, 'name');
  const file = formData.get('file');
  const values = { name };
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file to upload.', values };
  if (!file.name.toLowerCase().endsWith('.csv')) return { error: 'Only .csv files are supported.', values };
  if (file.size > MAX_CSV_BYTES) return { error: 'CSV files are limited to 50 MB.', values };

  const body = new FormData();
  body.set('name', name || file.name.replace(/\.csv$/i, ''));
  body.set('file', file, file.name);

  // No explicit Content-Type: fetch sets the multipart boundary itself.
  const res = await apiRequest<{ id: string }>('/data-sources/upload', { method: 'POST', body });
  if (!res.ok) return { error: res.error, values };
  revalidatePath('/data-sources');
  redirect(`/data-sources/${res.data.id}`);
}

export async function syncDataSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const res = await apiRequest(`/data-sources/${encodeURIComponent(id)}/sync`, { method: 'POST' });
  revalidatePath(`/data-sources/${id}`);
  if (!res.ok) return { error: res.error };
  return { success: 'Schema re-discovered.' };
}

export async function deleteDataSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const res = await apiRequest(`/data-sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return { error: res.error };
  revalidatePath('/data-sources');
  redirect('/data-sources');
}
