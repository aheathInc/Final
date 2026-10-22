'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Activity, Database, LogOut } from 'lucide-react';

const ITEMS = [
  { icon: Activity, label: 'Ufuatiliaji wa magonjwa', href: '/surveillance' },
  { icon: Database, label: 'Utafiti', href: '/research' },
];

const HIDE_ON = ['/login'];

export function Nav() {
  const pathname = usePathname() ?? '';
  if (HIDE_ON.some((r) => pathname.startsWith(r))) return null;

  return (
    <aside className="w-60 shrink-0 border-r border-line bg-white">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto p-5">
        <Link href="/surveillance" className="text-lg font-semibold tracking-tight text-petrol">
          A-health
        </Link>
        <p className="text-xs text-ink-soft">Afya ya umma</p>

        <nav className="mt-6 flex-1">
          {ITEMS.map((item) => {
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
