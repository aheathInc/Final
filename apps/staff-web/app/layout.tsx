import type { Metadata } from 'next';
import { StaffShell } from '@/components/premium/StaffShell';
import { DisplayProvider } from '@/components/premium/DisplayPreferences';
import { Providers } from '@/components/Providers';
import './globals.css';
import './care-continuity.css';
import './premium-clinical.css';

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
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ahp.staff.theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.density=localStorage.getItem('ahp.staff.density')==='compact'?'compact':'comfortable';}catch(e){}})();` }} />
        <Providers>
          <DisplayProvider><StaffShell>{children}</StaffShell></DisplayProvider>
        </Providers>
      </body>
    </html>
  );
}
