'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createInvestigationAction } from '../../../lib/actions/investigations';
import { INITIAL_FORM_STATE } from '../../../lib/actions/form-state';
import type { Project } from '../../../lib/api';
import { FormMessage } from '../../../components/form-controls';
import { AnimatePresence, EASE, motion } from '../../../components/motion';
import { useSound } from '../../../components/experience';

const SUGGESTIONS = [
  'Why did revenue drop last week?',
  'Why did refunds spike?',
  'Which channel is driving the decline in completed orders?',
  'Did a deploy hurt checkout on Oct 8?',
];

const AGENTS = ['Coordinator', 'Analytics', 'Finance', 'Customer', 'Product'];

/** Command-console style prompt: big input, suggestion chips, animated launch. */
export function NewInvestigationForm({ projects }: { projects: Pick<Project, 'id' | 'name'>[] }) {
  const [state, action] = useActionState(createInvestigationAction, INITIAL_FORM_STATE);
  const [question, setQuestion] = useState(state.values?.question ?? '');
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const play = useSound();

  useEffect(() => {
    if (state.error) play('error');
  }, [state, play]);

  const ready = question.trim().length >= 5;
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={() => play('launch')}
      className="space-y-4"
    >
      <div className="group relative rounded-2xl border border-[var(--border-strong)] bg-[var(--canvas)] shadow-[inset_0_1px_0_var(--glow)] transition-shadow focus-within:shadow-[0_0_0_1px_var(--accent),0_0_48px_-12px_var(--glow-strong)]">
        <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <span className="mt-1.5 select-none font-mono text-lg leading-none text-[var(--text-muted)]" aria-hidden>
            &gt;
          </span>
          <label htmlFor="question" className="sr-only">
            Question
          </label>
          <textarea
            ref={inputRef}
            id="question"
            name="question"
            rows={2}
            required
            minLength={5}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder="Ask HELIX why something changed..."
            aria-describedby="question-hint"
            className="block w-full resize-none bg-transparent text-xl font-medium leading-snug tracking-tight text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none sm:text-2xl"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="projectId" className="sr-only">
              Project
            </label>
            <select
              id="projectId"
              name="projectId"
              required
              defaultValue={state.values?.projectId ?? projects[0]?.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span id="question-hint" className="hidden text-[11px] text-[var(--text-muted)] sm:inline">
              <kbd className="rounded border border-[var(--border)] px-1 font-mono">⌘</kbd>{' '}
              <kbd className="rounded border border-[var(--border)] px-1 font-mono">Enter</kbd> to launch
            </span>
          </div>
          <LaunchButton ready={ready} />
        </div>
        <LaunchSweep />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 * i, ease: EASE }}
            onClick={() => {
              setQuestion(s);
              inputRef.current?.focus();
            }}
            aria-pressed={question === s}
            className={`rounded-full border px-3 py-1.5 text-xs transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              question === s
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
            }`}
          >
            {s}
          </motion.button>
        ))}
      </div>
      <FormMessage state={state} />
    </form>
  );
}

function LaunchButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      data-silent
      className={`group/launch relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] disabled:cursor-wait ${
        ready
          ? 'shadow-[0_0_0_1px_var(--accent),0_10px_36px_-8px_var(--glow-strong)] hover:-translate-y-px'
          : 'opacity-70'
      }`}
    >
      {pending && <span className="helix-shimmer absolute inset-0" aria-hidden />}
      <span className="relative">{pending ? 'Launching agents' : 'Launch investigation'}</span>
      <motion.span
        className="relative"
        aria-hidden
        animate={pending ? { x: [0, 6, 0] } : { x: 0 }}
        transition={pending ? { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover/launch:translate-x-0.5">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </motion.span>
    </button>
  );
}

/** While submitting, the five agents light up one after another under the prompt. */
function LaunchSweep() {
  const { pending } = useFormStatus();
  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden border-t border-[var(--border)]"
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5" role="status">
            <span className="text-[11px] text-[var(--text-muted)]">Briefing</span>
            {AGENTS.map((a, i) => (
              <motion.span
                key={a}
                initial={{ opacity: 0.25, scale: 0.9 }}
                animate={{ opacity: [0.25, 1, 0.6], scale: [0.9, 1.05, 1] }}
                transition={{ duration: 0.9, delay: i * 0.18, repeat: Infinity, repeatDelay: AGENTS.length * 0.18 }}
                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] font-medium"
              >
                {a}
              </motion.span>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
