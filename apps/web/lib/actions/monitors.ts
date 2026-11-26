'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, type MonitorRunResult, type MonitorSuggestion } from '../api';
import { monitorStatusLabel } from '../monitoring';
import { field, type FormState } from './form-state';

function refresh() {
  revalidatePath('/monitoring');
  revalidatePath('/', 'layout');
}

/** One-line outcome of a monitor run for the inline message. */
function describeRun(r: MonitorRunResult): string {
  return r.message?.trim() ? r.message : monitorStatusLabel(r.status);
}

/** Creates a monitor from a suggestion (posted as JSON) in the chosen project. */
export async function createMonitorFromSuggestionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = field(formData, 'projectId');
  if (!projectId) return { error: 'Choose a project for the monitor.' };
  let suggestion: MonitorSuggestion;
  try {
    suggestion = JSON.parse(field(formData, 'suggestion')) as MonitorSuggestion;
  } catch {
    return { error: 'That suggestion could not be read. Refresh and try again.' };
  }
  const res = await apiRequest<{ id: string }>('/monitors', {
    method: 'POST',
    json: {
      name: suggestion.name,
      projectId,
      dataSourceId: suggestion.dataSourceId,
      metricKey: suggestion.metricKey,
      tableName: suggestion.tableName,
      timeColumn: suggestion.timeColumn,
      ...(suggestion.valueColumn ? { valueColumn: suggestion.valueColumn } : {}),
      aggregation: suggestion.aggregation,
      ...(suggestion.filter ? { filter: suggestion.filter } : {}),
      ...(suggestion.unit ? { unit: suggestion.unit } : {}),
    },
  });
  if (!res.ok) return { error: res.error };
  refresh();
  return { success: `Monitor "${suggestion.name}" added.` };
}

export async function setMonitorEnabledAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const enabled = field(formData, 'enabled') === 'true';
  const res = await apiRequest(`/monitors/${encodeURIComponent(id)}`, { method: 'PATCH', json: { enabled } });
  refresh();
  if (!res.ok) return { error: res.error };
  return { success: enabled ? 'Monitor enabled.' : 'Monitor paused.' };
}

export async function runMonitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const res = await apiRequest<MonitorRunResult>(`/monitors/${encodeURIComponent(id)}/run`, { method: 'POST' });
  refresh();
  if (!res.ok) return { error: res.error };
  return {
    success: describeRun(res.data),
    meta: res.data.investigationId ? { investigationId: res.data.investigationId } : undefined,
  };
}

export async function runAllMonitorsAction(_prev: FormState): Promise<FormState> {
  const res = await apiRequest<MonitorRunResult[]>('/monitors/run', { method: 'POST' });
  refresh();
  if (!res.ok) return { error: res.error };
  const results = Array.isArray(res.data) ? res.data : [];
  if (results.length === 0) return { success: 'No enabled monitors to run.' };
  const opened = results.filter((r) => r.investigationId);
  return {
    success: `Ran ${results.length} monitor${results.length === 1 ? '' : 's'}. ${
      opened.length === 0
        ? 'No new investigations.'
        : `${opened.length} investigation${opened.length === 1 ? '' : 's'} opened.`
    }`,
    meta: opened[0]?.investigationId ? { investigationId: opened[0].investigationId } : undefined,
  };
}

export async function deleteMonitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, 'id');
  const res = await apiRequest(`/monitors/${encodeURIComponent(id)}`, { method: 'DELETE' });
  refresh();
  if (!res.ok) return { error: res.error };
  return { success: 'Monitor deleted.' };
}
