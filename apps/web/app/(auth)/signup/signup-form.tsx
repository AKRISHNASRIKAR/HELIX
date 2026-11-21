'use client';

import { useActionState } from 'react';
import { signupAction } from '../../../lib/actions/auth';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { Field, inputClass } from '../../../components/ui';

export function SignupForm() {
  const [state, action] = useActionState(signupAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-4">
      <Field id="name" label="Full name">
        <input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} className={inputClass} />
      </Field>
      <Field id="email" label="Work email">
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className={inputClass} />
      </Field>
      <Field id="password" label="Password" hint="At least 8 characters.">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-describedby="password-hint"
          className={inputClass}
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating account..." className="w-full">
        Create account
      </SubmitButton>
    </form>
  );
}
