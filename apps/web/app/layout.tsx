import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ExperienceProvider, GlobalSounds } from '../components/experience';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'HELIX',
  description: 'Autonomous Enterprise Investigation Platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Runs before paint so the saved theme never flashes; dark is the default.
const THEME_SCRIPT = `try{var t=localStorage.getItem('helix-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

/** Root shell only; the app chrome lives in (app)/layout and the auth screens in (auth)/layout. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="helix-grain font-[family-name:var(--font-inter)]">
        <div className="helix-aurora" aria-hidden />
        <ExperienceProvider>
          <GlobalSounds />
          <div className="relative z-[1]">{children}</div>
        </ExperienceProvider>
      </body>
    </html>
  );
}
