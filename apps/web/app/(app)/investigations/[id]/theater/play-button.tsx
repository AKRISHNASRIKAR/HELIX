'use client';

import Link from 'next/link';
import { useSound } from '../../../../../components/experience';
import { buttonClass } from '../../../../../components/ui';

/** Prominent "Play the run" button that opens the theater (?play=1). */
export function PlayRunButton({ href, active }: { href: string; active: boolean }) {
  const play = useSound();
  return (
    <Link
      href={href}
      scroll={false}
      data-silent
      onClick={() => play('launch')}
      aria-pressed={active}
      className={`${buttonClass('primary', 'md')} group !px-5 !py-2.5`}
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent-contrast)] text-[var(--accent)] transition-transform duration-300 group-hover:scale-110" aria-hidden>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 4v16l13-8z" />
        </svg>
      </span>
      {active ? 'Replay the run' : 'Play the run'}
    </Link>
  );
}
