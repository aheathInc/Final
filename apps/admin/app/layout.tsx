import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Nav } from '@/components/Nav';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600'],
  variable: '--font-plex-sans', display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['500'],
  variable: '--font-plex-mono', display: 'swap',
});

export const metadata: Metadata = {
  title: 'A-health — Uendeshaji',
  description: 'Dharura, vituo, vifaa na usimamizi wa jukwaa.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sw" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">
        <div className="flex min-h-screen">
          <Nav />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
