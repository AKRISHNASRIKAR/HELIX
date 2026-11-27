import { LogoMark } from '../../components/logo';
import { SoundToggle, ThemeToggle } from '../../components/experience';
import { AuthHero } from '../../components/brand/auth-hero';

export const dynamic = 'force-dynamic';

/**
 * Split screen for sign-in, sign-up and onboarding: an animated hero that
 * explains HELIX on the left (large screens), the form on the right.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.25fr)_minmax(440px,1fr)]">
      <AuthHero />

      <main className="relative flex min-h-screen flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 lg:invisible">
            <LogoMark />
            <div>
              <p className="text-sm font-semibold tracking-tight">HELIX</p>
              <p className="text-[11px] text-[var(--text-muted)]">Autonomous investigations</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <SoundToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <p className="mb-6 text-2xl font-semibold leading-tight tracking-tight lg:hidden">
              Autonomous investigations for your business data.
            </p>
            <div className="helix-beam rounded-2xl">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow-lg)]">
                {children}
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--text-muted)]">
          Agents read only the sources you connect. Credentials are encrypted at rest.
        </p>
      </main>
    </div>
  );
}
