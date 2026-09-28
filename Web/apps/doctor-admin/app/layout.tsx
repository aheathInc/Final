import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Nav } from '@/components/Nav';
import './globals.css';

/*
 * One family across the scale; weight and size carry the hierarchy. Plex Mono
 * appears only on countdowns and lab values, where tabular figures stop the
 * number jittering as it ticks and keep a column of results aligned — both
 * cases where the digits are the content, not decoration.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600'],
  variable: '--font-plex-sans', display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['500'],
  variable: '--font-plex-mono', display: 'swap',
});

export const metadata: Metadata = {
  title: 'A-health — Daktari',
  description: 'Foleni ya kesi na usimamizi wa matibabu.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sw" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Nav />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
