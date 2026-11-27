export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_20px_-4px_var(--glow-strong)] ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <path d="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 21c0-2 1-3 3-4M18 21c0-2-1-3-3-4" />
      </svg>
    </span>
  );
}
