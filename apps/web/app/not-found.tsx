import Link from 'next/link';
import { buttonClass } from '../components/ui';
import { LogoMark } from '../components/logo';
import { Reveal } from '../components/motion';

export default function NotFound() {
  return (
    <main className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-4 text-center">
      <div className="helix-dots pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <Reveal className="relative flex flex-col items-center">
        <LogoMark className="h-10 w-10" />
        <p
          className="mt-6 select-none text-[clamp(96px,18vw,180px)] font-semibold leading-none tracking-tighter text-transparent"
          style={{ WebkitTextStroke: '1.5px var(--border-strong)' }}
          aria-hidden
        >
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Nothing to investigate here</h1>
        <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
          That page or record does not exist, or it belongs to another organization.
        </p>
        <Link href="/" className={`mt-6 ${buttonClass('primary', 'md')}`}>
          ← Back to dashboard
        </Link>
      </Reveal>
    </main>
  );
}
