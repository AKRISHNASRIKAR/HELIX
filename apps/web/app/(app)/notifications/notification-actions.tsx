'use client';

import { useActionState } from 'react';
import { markAllNotificationsReadAction, markNotificationReadAction } from '../../../lib/actions/notifications';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../components/form-controls';

export function MarkAllReadButton() {
  const [state, action] = useActionState(markAllNotificationsReadAction, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Marking...">
          Mark all as read
        </SubmitButton>
      </form>
      {state.error && <FormMessage state={state} />}
    </div>
  );
}

export function MarkReadButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(markNotificationReadAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={`Mark "${title}" as read`}
        className="rounded px-1.5 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)]"
      >
        Mark read
      </button>
      {state.error && <span className="text-[11px] text-[var(--text-bad)]">{state.error}</span>}
    </form>
  );
}
