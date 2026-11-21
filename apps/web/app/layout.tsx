import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NavLink } from '../components/nav-link';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'HELIX',
  description: 'Autonomous Enterprise Investigation Platform',
};

const NAV = [
  { href: '/', label: 'Overview', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/investigations', label: 'Investigations', icon: 'M11 4a7 7 0 105.3 11.6L21 20M11 8v6M8 11h6' },
];

const SOON = ['Anomalies', 'Data sources', 'Agents', 'Reports'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-[family-name:var(--font-inter)]">
        <div className="flex min-h-screen">
          <div className="hidden w-60 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] lg:block">
          <aside className="sticky top-0 flex h-screen flex-col px-4 py-5">
            <div className="flex items-center gap-2.5 px-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b0b0b] text-white">
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 21c0-2 1-3 3-4M18 21c0-2-1-3-3-4" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold tracking-tight">HELIX</p>
                <p className="text-[11px] text-[var(--text-muted)]">Acme Corp · Production</p>
              </div>
            </div>

            <nav className="mt-8 space-y-0.5">
              {NAV.map((item) => (
                <NavLink key={item.href} href={item.href} icon={item.icon}>
                  {item.label}
                </NavLink>
              ))}
              {SOON.map((label) => (
                <span key={label} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm text-[var(--text-muted)]">
                  {label}
                  <span className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-[10px]">soon</span>
                </span>
              ))}
            </nav>

            <div className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
              <p className="text-xs font-medium">6 agents online</p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">4 busy · 2 idle · 0 failing</p>
              <div className="mt-2 flex gap-1">
                {[1, 1, 1, 1, 0, 0].map((b, i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${b ? 'bg-[var(--series-1)]' : 'bg-[var(--series-1-soft)]'}`} />
                ))}
              </div>
            </div>
          </aside>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 sm:py-8">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
