import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Providers } from '@/components/Providers';
import './globals.css';

/*
 * One family across the scale; weight and size carry the hierarchy. Plex Mono
 * appears only on countdowns and lab values, where tabular figures stop the
 * number jittering as it ticks and keep a column of results aligned — both
 * cases where the digits are the content, not decoration.
 */
export const metadata: Metadata = {
  title: 'A-health',
  description: 'Clinician care, health operations and research intelligence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>
          <div className="flex min-h-screen bg-paper text-ink max-md:flex-col">
            <Nav />
            <main className="surface-grid min-w-0 flex-1 bg-[radial-gradient(circle_at_top_right,rgba(43,145,217,0.12),transparent_34rem)]">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
