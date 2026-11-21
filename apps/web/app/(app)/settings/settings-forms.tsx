'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addMemberAction, createProjectAction } from '../../../lib/actions/settings';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { Field, inputClass } from '../../../components/ui';

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field id="project-name" label="Name">
          <input id="project-name" name="name" required placeholder="Growth" defaultValue={state.values?.name} className={inputClass} />
        </Field>
        <Field id="project-description" label="Description (optional)">
          <input id="project-description" name="description" defaultValue={state.values?.description} className={inputClass} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Creating...">
          Create project
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function AddMemberForm({ canGrantOwner }: { canGrantOwner: boolean }) {
  const [state, action] = useActionState(addMemberAction, INITIAL_FORM_STATE);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.success) emailRef.current?.focus();
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field id="member-email" label="Email" hint="They need an existing HELIX account.">
          <input
            ref={emailRef}
            id="member-email"
            name="email"
            type="email"
            required
            aria-describedby="member-email-hint"
            defaultValue={state.error ? state.values?.email : undefined}
            className={inputClass}
          />
        </Field>
        <Field id="member-role" label="Role">
          <select id="member-role" name="role" defaultValue={state.values?.role ?? 'MEMBER'} className={inputClass}>
            {canGrantOwner && <option value="OWNER">Owner</option>}
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer (read only)</option>
          </select>
        </Field>
      </div>
      <SubmitButton size="sm" pendingLabel="Adding...">
        Add member
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
