'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Inbox, CalendarDays, FlaskConical, HeartPulse, Users2, MessagesSquare,
  Sparkles, BookOpen, Pill, ShieldCheck, Settings, LogOut, Stethoscope,
} from 'lucide-react';

/**
 * Grouped by when a clinician reaches for them, not alphabetically. The queue
 * is first because that is where a shift starts; reference material is last
 * because it is looked up, not worked through.
 */
const GROUPS = [
  {
    label: 'Kazi ya leo',
    items: [
      { icon: Inbox, label: 'Foleni', href: '/queue' },
      { icon: CalendarDays, label: 'Miadi', href: '/appointments' },
      { icon: Stethoscope, label: 'Ratiba yangu', href: '/slots' },
    ],
  },
  {
    label: 'Wagonjwa',
    items: [
      { icon: FlaskConical, label: 'Vipimo', href: '/diagnostics' },
      { icon: HeartPulse, label: 'Ufuatiliaji', href: '/follow-up' },
      { icon: Users2, label: 'Familia', href: '/families' },
    ],
  },
  {
    label: 'Wataalamu',
    items: [
      { icon: MessagesSquare, label: 'Jamii', href: '/network' },
      { icon: ShieldCheck, label: 'Maoni ya pili', href: '/second-opinions' },
    ],
  },
  {
    label: 'Rejea',
    items: [
      { icon: Sparkles, label: 'Msaidizi', href: '/assistant' },
      { icon: Pill, label: 'Dawa', href: '/pharmacy' },
      { icon: BookOpen, label: 'Elimu', href: '/education' },
      { icon: Settings, label: 'Mipangilio', href: '/settings' },
    ],
  },
];

// Reached before signing in. Showing the signed-in navigation there tells
// someone with no session exactly what the app contains.
const HIDE_ON = ['/login'];

export function Nav() {
  const pathname = usePathname() ?? '';
  if (HIDE_ON.some((r) => pathname.startsWith(r))) return null;

  return (
    <aside className="w-full shrink-0 border-b border-[#d8e2db] bg-[#f8faf8] lg:w-72 lg:border-b-0 lg:border-r">
      <div className="sticky top-0 flex max-h-[42vh] flex-col overflow-y-auto px-4 py-4 lg:h-screen lg:max-h-none lg:py-5">
        <div className="mb-5 flex items-center justify-between px-2 lg:mb-8">
          <Link href="/queue" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-petrol">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-petrol text-sm font-semibold text-white shadow-sm">A</span>
            <span>A-health</span>
          </Link>
          <span className="h-2.5 w-2.5 rounded-full bg-[#48a77a]" title="Mfumo uko tayari" />
        </div>

        <nav className="flex-1">
          {GROUPS.map((group) => (
            <div key={group.label} className="mb-4 flex flex-wrap items-center gap-1 lg:mb-7 lg:block">
              <p className="mb-2 w-full px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#789087]">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`mb-1 flex min-h-10 items-center gap-3 rounded-xl px-3 text-[0.88rem] transition-colors lg:min-h-11 lg:text-[0.92rem] ${
                      active ? 'bg-[#dcece3] font-semibold text-petrol shadow-sm' : 'text-ink-soft hover:bg-[#edf4ef] hover:text-ink'
                    }`}
                  >
                    <item.icon size={17} aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="mt-2 border-t border-[#d8e2db] pt-3 lg:mt-4 lg:pt-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white px-3 py-3 shadow-[0_1px_3px_rgba(16,36,31,0.05)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dcece3] text-sm font-semibold text-petrol">DK</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">Daktari</p>
              <p className="text-xs text-ink-soft">Ziko tayari</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-[0.92rem] text-ink-soft transition-colors hover:bg-[#edf4ef] hover:text-ink"
          >
            <LogOut size={17} aria-hidden />
            Toka kwenye akaunti
          </button>
        </div>
      </div>
    </aside>
  );
}
