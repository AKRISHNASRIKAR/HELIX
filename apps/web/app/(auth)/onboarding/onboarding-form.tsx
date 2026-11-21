'use client';

import { useActionState } from 'react';
import { onboardingAction } from '../../../lib/actions/auth';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { Field, inputClass } from '../../../components/ui';

export function OnboardingForm() {
  const [state, action] = useActionState(onboardingAction, INITIAL_FORM_STATE);
  const orgCreated = Boolean(state.meta?.organizationId);
  return (
    <form action={action} className="space-y-4">
      {orgCreated && <input type="hidden" name="organizationId" value={state.meta!.organizationId} />}
      <Field id="organizationName" label="Organization name" hint={orgCreated ? 'Already created.' : 'Your company or team.'}>
        <input
          id="organizationName"
          name="organizationName"
          required={!orgCreated}
          disabled={orgCreated}
          placeholder="Acme Corp"
          defaultValue={state.values?.organizationName}
          aria-describedby="organizationName-hint"
          className={inputClass}
        />
      </Field>
      <Field id="projectName" label="First project" hint="Projects group related investigations, e.g. Revenue or Growth.">
        <input
          id="projectName"
          name="projectName"
          required
          placeholder="Revenue"
          defaultValue={state.values?.projectName}
          aria-describedby="projectName-hint"
          className={inputClass}
        />
      </Field>
      <Field id="projectDescription" label="Project description (optional)">
        <textarea
          id="projectDescription"
          name="projectDescription"
          rows={2}
          defaultValue={state.values?.projectDescription}
          className={inputClass}
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Setting up..." className="w-full">
        Continue
      </SubmitButton>
    </form>
  );
}
