'use client';

import { useActionState } from 'react';
import { createInvestigationAction } from '../../../lib/actions/investigations';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import type { Project } from '../../../lib/api';
import { FormMessage, SubmitButton } from '../../../components/form-controls';
import { Field, inputClass } from '../../../components/ui';

const EXAMPLES = [
  'Why did revenue drop last week?',
  'What caused the spike in refunds on Oct 8?',
  'Which channel is driving the decline in completed orders?',
];

export function NewInvestigationForm({ projects }: { projects: Pick<Project, 'id' | 'name'>[] }) {
  const [state, action] = useActionState(createInvestigationAction, INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-4">
      <Field id="question" label="Question" hint={`For example: ${EXAMPLES.join(' / ')}`}>
        <textarea
          id="question"
          name="question"
          rows={3}
          required
          minLength={5}
          maxLength={2000}
          placeholder="Why did revenue drop last week?"
          aria-describedby="question-hint"
          defaultValue={state.values?.question}
          className={`${inputClass} resize-y`}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="projectId" label="Project" className="min-w-[200px] flex-1 sm:flex-none">
          <select
            id="projectId"
            name="projectId"
            required
            defaultValue={state.values?.projectId ?? projects[0]?.id}
            className={inputClass}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton pendingLabel="Starting...">Start investigation</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
