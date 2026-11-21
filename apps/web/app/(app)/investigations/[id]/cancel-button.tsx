'use client';

import { useActionState } from 'react';
import { cancelInvestigationAction } from '../../../../lib/actions/investigations';
import { INITIAL_FORM_STATE } from '../../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../../components/form-controls';

export function CancelInvestigationButton({ id }: { id: string }) {
  const [state, action] = useActionState(cancelInvestigationAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        variant="danger"
        size="sm"
        pendingLabel="Cancelling..."
        confirmMessage="Cancel this investigation? Agents that already finished keep their results."
      >
        Cancel investigation
      </SubmitButton>
      {state.error && <FormMessage state={state} />}
    </form>
  );
}
