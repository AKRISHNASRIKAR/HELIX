/** Shape returned by every form server action (consumed via useActionState). */
export interface FormState {
  error?: string;
  success?: string;
  /** Echoed values so a failed submit doesn't wipe the form. */
  values?: Record<string, string>;
  /** Action-specific extras (e.g. an id created by a partially successful step). */
  meta?: Record<string, string>;
}

export const INITIAL_FORM_STATE: FormState = {};

/** Reads a trimmed string field from FormData ('' when missing). */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
