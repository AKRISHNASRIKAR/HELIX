import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'HELIX',
  description: 'Autonomous Enterprise Investigation Platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Root shell only; the app chrome lives in (app)/layout and the auth screens in (auth)/layout. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-[family-name:var(--font-inter)]">{children}</body>
    </html>
  );
}
