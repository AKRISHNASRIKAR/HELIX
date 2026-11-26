'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  createMonitorFromSuggestionAction,
  deleteMonitorAction,
  runAllMonitorsAction,
  runMonitorAction,
  setMonitorEnabledAction,
} from '../../../lib/actions/monitors';
import { INITIAL_FORM_STATE, type FormState } from '../../../lib/actions/form-state';
import type { MonitorSuggestion } from '../../../lib/api';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { buttonClass, inputClass, linkClass } from '../../../components/ui';

function RunResult({ state }: { state: FormState }) {
  if (!state.error && !state.success) return null;
  const investigationId = state.meta?.investigationId;
  return (
    <div className="max-w-xs text-left">
      <FormMessage state={state} />
      {investigationId && (
        <Link href={`/investigations/${investigationId}`} className={`mt-1 inline-block text-xs font-medium ${linkClass}`}>
          Open investigation →
        </Link>
      )}
    </div>
  );
}

export function RunAllMonitorsButton({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState(runAllMonitorsAction, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        {disabled ? (
          <button type="button" disabled className={buttonClass('primary', 'sm')}>
            Run all now
          </button>
        ) : (
          <SubmitButton size="sm" pendingLabel="Running monitors...">
            Run all now
          </SubmitButton>
        )}
      </form>
      <RunResult state={state} />
    </div>
  );
}

export function MonitorRowActions({ id, name }: { id: string; name: string }) {
  const [runState, run] = useActionState(runMonitorAction, INITIAL_FORM_STATE);
  const [deleteState, remove] = useActionState(deleteMonitorAction, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <form action={run}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Running...">
            Run now
          </SubmitButton>
        </form>
        <form action={remove}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton
            variant="ghost"
            size="sm"
            pendingLabel="Deleting..."
            confirmMessage={`Delete the monitor "${name}"? Investigations it opened are kept.`}
          >
            <span className="sr-only">Delete {name}</span>
            <span aria-hidden>Delete</span>
          </SubmitButton>
        </form>
      </div>
      <RunResult state={deleteState.error ? deleteState : runState} />
    </div>
  );
}

/** Accessible switch that PATCHes `enabled`. */
export function MonitorToggle({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const [state, action] = useActionState(setMonitorEnabledAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Pause' : 'Enable'} monitor ${name}`}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:ring-offset-2 ${
          enabled ? 'bg-[var(--series-1)]' : 'bg-[#d4d3cd]'
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </button>
      {state.error && <span className="text-[11px] text-[var(--text-bad)]">{state.error}</span>}
    </form>
  );
}

export function AddSuggestionForm({
  suggestion,
  projects,
  formId,
}: {
  suggestion: MonitorSuggestion;
  projects: { id: string; name: string }[];
  formId: string;
}) {
  const [state, action] = useActionState(createMonitorFromSuggestionAction, INITIAL_FORM_STATE);
  if (state.success) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col items-stretch gap-2 sm:items-end">
      <input type="hidden" name="suggestion" value={JSON.stringify(suggestion)} />
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {projects.length > 1 ? (
          <>
            <label htmlFor={`${formId}-project`} className="sr-only">
              Project for {suggestion.name}
            </label>
            <select id={`${formId}-project`} name="projectId" required defaultValue={projects[0]?.id} className={`${inputClass} !w-auto !py-1.5 text-xs`}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <input type="hidden" name="projectId" value={projects[0]?.id ?? ''} />
        )}
        <SubmitButton variant="secondary" size="sm" pendingLabel="Adding...">
          Add monitor
        </SubmitButton>
      </div>
      {state.error && <FormMessage state={state} />}
    </form>
  );
}
