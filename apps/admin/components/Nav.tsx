'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Siren, Building2, Radio, ShieldAlert, CreditCard, BadgeCheck, Settings, LogOut,
} from 'lucide-react';

/**
 * Dispatch first, because that is the screen someone sits in front of for a
 * whole shift. Everything below it is periodic work, not continuous.
 */
const GROUPS = [
  {
    label: 'Uendeshaji',
    items: [
      { icon: Siren, label: 'Dharura', href: '/emergency' },
      { icon: Radio, label: 'Vifaa', href: '/devices' },
    ],
  },
  {
    label: 'Usimamizi',
    items: [
      { icon: BadgeCheck, label: 'Uthibitisho', href: '/verification' },
      { icon: Building2, label: 'Vituo', href: '/facilities' },
      { icon: ShieldAlert, label: 'Matukio', href: '/incidents' },
      { icon: CreditCard, label: 'Malipo', href: '/payments' },
    ],
  },
  {
    label: 'Akaunti',
    items: [{ icon: Settings, label: 'Mipangilio', href: '/settings' }],
  },
];

const HIDE_ON = ['/login'];

export function Nav() {
  const pathname = usePathname() ?? '';
  if (HIDE_ON.some((r) => pathname.startsWith(r))) return null;

  return (
    <aside className="w-60 shrink-0 border-r border-line bg-white">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto p-5">
        <Link href="/emergency" className="text-lg font-semibold tracking-tight text-petrol">
          A-health
        </Link>
        <p className="text-xs text-ink-soft">Uendeshaji</p>

        <nav className="mt-6 flex-1">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-6">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {g.label}
              </p>
              {g.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex min-h-10 items-center gap-2.5 px-2 text-[0.95rem] ${
                      active ? 'font-medium text-petrol' : 'text-ink-soft hover:text-ink'
                    }`}>
                    <item.icon size={17} aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex min-h-10 items-center gap-2.5 px-2 text-[0.95rem] text-ink-soft hover:text-ink">
          <LogOut size={17} aria-hidden />
          Toka
        </button>
      </div>
    </aside>
  );
}
