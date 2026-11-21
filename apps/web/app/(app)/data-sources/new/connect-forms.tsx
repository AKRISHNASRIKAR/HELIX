'use client';

import { useActionState } from 'react';
import { createPostgresSourceAction, uploadCsvSourceAction } from '../../../../lib/actions/data-sources';
import { INITIAL_FORM_STATE } from '../../../../lib/actions/form-state';
import { FormMessage, SubmitButton } from '../../../../components/form-controls';
import { Field, inputClass } from '../../../../components/ui';

export function PostgresForm() {
  const [state, action] = useActionState(createPostgresSourceAction, INITIAL_FORM_STATE);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4">
      <Field id="pg-name" label="Display name">
        <input id="pg-name" name="name" required placeholder="warehouse-prod" defaultValue={v.name} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field id="pg-host" label="Host">
          <input id="pg-host" name="host" required placeholder="db.internal.example.com" autoCapitalize="off" spellCheck={false} defaultValue={v.host} className={inputClass} />
        </Field>
        <Field id="pg-port" label="Port">
          <input id="pg-port" name="port" type="number" min={1} max={65535} required defaultValue={v.port ?? '5432'} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pg-database" label="Database">
          <input id="pg-database" name="database" required autoCapitalize="off" spellCheck={false} defaultValue={v.database} className={inputClass} />
        </Field>
        <Field id="pg-schema" label="Schema" hint="Defaults to public.">
          <input id="pg-schema" name="schema" placeholder="public" autoCapitalize="off" spellCheck={false} aria-describedby="pg-schema-hint" defaultValue={v.schema} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pg-user" label="User" hint="A read-only role is recommended.">
          <input id="pg-user" name="user" required autoComplete="off" autoCapitalize="off" spellCheck={false} aria-describedby="pg-user-hint" defaultValue={v.user} className={inputClass} />
        </Field>
        <Field id="pg-password" label="Password">
          <input id="pg-password" name="password" type="password" autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Connecting and discovering schema...">Connect database</SubmitButton>
    </form>
  );
}

export function CsvForm() {
  const [state, action] = useActionState(uploadCsvSourceAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-4">
      <Field id="csv-name" label="Display name" hint="Defaults to the file name.">
        <input id="csv-name" name="name" placeholder="orders-q3" aria-describedby="csv-name-hint" defaultValue={state.values?.name} className={inputClass} />
      </Field>
      <Field id="csv-file" label="CSV file" hint="One table per file, header row required, up to 50 MB.">
        <input
          id="csv-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-describedby="csv-file-hint"
          className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-[var(--canvas)] file:px-2.5 file:py-1 file:text-xs file:font-medium`}
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Uploading and profiling...">Upload CSV</SubmitButton>
    </form>
  );
}
