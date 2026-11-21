import { LogoMark } from '../../components/logo';

export const dynamic = 'force-dynamic';

/** Bare, centered shell for sign-in, sign-up and onboarding. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <LogoMark />
        <div>
          <p className="text-sm font-semibold tracking-tight">HELIX</p>
          <p className="text-[11px] text-[var(--text-muted)]">Autonomous investigations</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {children}
      </div>
    </main>
  );
}
