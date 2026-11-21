'use client';

import { useActionState } from 'react';
import { deleteDataSourceAction, syncDataSourceAction } from '../../../../lib/actions/data-sources';
import { INITIAL_FORM_STATE } from '../../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../../components/form-controls';

/** Sync (re-discover schema) and Delete buttons with inline result messages. */
export function SourceActions({ id, name }: { id: string; name: string }) {
  const [syncState, sync] = useActionState(syncDataSourceAction, INITIAL_FORM_STATE);
  const [deleteState, remove] = useActionState(deleteDataSourceAction, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <form action={sync}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Syncing...">
            Sync schema
          </SubmitButton>
        </form>
        <form action={remove}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton
            variant="danger"
            size="sm"
            pendingLabel="Deleting..."
            confirmMessage={`Delete "${name}"? Investigations will no longer be able to read it.`}
          >
            Delete
          </SubmitButton>
        </form>
      </div>
      <div className="max-w-sm empty:hidden">
        <FormMessage state={deleteState.error ? deleteState : syncState} />
      </div>
    </div>
  );
}
