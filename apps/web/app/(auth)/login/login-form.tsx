'use client';

import { useActionState } from 'react';
import { loginAction } from '../../../lib/actions/auth';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { Field, inputClass } from '../../../components/ui';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field id="email" label="Email">
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className={inputClass} />
      </Field>
      <Field id="password" label="Password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Signing in..." className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
