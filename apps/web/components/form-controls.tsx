'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import type { FormState } from '../lib/actions/form-state';
import { Notice, buttonClass, type ButtonVariant } from './ui';

/** Submit button that disables itself and swaps its label while pending. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size = 'md',
  className = '',
  confirmMessage,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  className?: string;
  /** Ask for confirmation before submitting (destructive actions). */
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${buttonClass(variant, size)} ${className}`}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? 'Working...') : children}
    </button>
  );
}

/** Renders a server action's error / success message. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (state.success) return <Notice tone="success">{state.success}</Notice>;
  return null;
}
