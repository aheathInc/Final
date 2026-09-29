'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import {
  Activity, Siren, BadgeCheck, BookOpen, Building2, CalendarDays, CreditCard,
  Database, FlaskConical, HeartPulse, Home, Inbox, LayoutDashboard, LogOut, MessagesSquare, Pill,
  Radio, Settings, ShieldAlert, Sparkles, Stethoscope, Users2,
} from 'lucide-react';

const HIDE_ON = ['/login'];

const DOCTOR = [
  { icon: Inbox, label: 'Queue', href: '/doctor/queue' },
  { icon: CalendarDays, label: 'Appointments', href: '/doctor/appointments' },
  { icon: Stethoscope, label: 'Slots', href: '/doctor/slots' },
  { icon: FlaskConical, label: 'Diagnostics', href: '/doctor/diagnostics' },
  { icon: HeartPulse, label: 'Follow-up', href: '/doctor/follow-up' },
  { icon: Users2, label: 'Families', href: '/doctor/families' },
  { icon: MessagesSquare, label: 'Network', href: '/doctor/network' },
  { icon: BadgeCheck, label: 'Second opinions', href: '/doctor/second-opinions' },
  { icon: Sparkles, label: 'Assistant', href: '/doctor/assistant' },
  { icon: Pill, label: 'Pharmacy', href: '/doctor/pharmacy' },
  { icon: BookOpen, label: 'Education', href: '/doctor/education' },
  { icon: Settings, label: 'Settings', href: '/doctor/settings' },
];

const ADMIN = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard' },
  { icon: Siren, label: 'Emergency', href: '/admin/emergency' },
  { icon: Radio, label: 'Devices', href: '/admin/devices' },
  { icon: BadgeCheck, label: 'Verification', href: '/admin/verification' },
  { icon: Building2, label: 'Facilities', href: '/admin/facilities' },
  { icon: ShieldAlert, label: 'Incidents', href: '/admin/incidents' },
  { icon: CreditCard, label: 'Payments', href: '/admin/payments' },
  { icon: Settings, label: 'Settings', href: '/admin/settings' },
];

const ANALYTICS = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/analytics/dashboard' },
  { icon: Activity, label: 'Surveillance', href: '/analytics/surveillance' },
  { icon: Database, label: 'Research', href: '/analytics/research' },
];

function itemsFor(role?: string) {
  if (role === 'clinician') return [{ label: 'Clinician', items: DOCTOR }];
  if (role === 'platform_admin') return [{ label: 'Operations', items: ADMIN }, { label: 'Analytics', items: ANALYTICS }];
  if (role === 'researcher') return [{ label: 'Analytics', items: ANALYTICS }];
  if (role === 'dispatcher') return [{ label: 'Operations', items: ADMIN.filter((i) => ['/admin/emergency', '/admin/devices'].includes(i.href)) }];
  if (role === 'facility_admin') return [{ label: 'Operations', items: ADMIN.filter((i) => ['/admin/facilities', '/admin/incidents', '/admin/settings'].includes(i.href)) }];
  return [];
}

function roleFromPath(pathname: string) {
  if (pathname.startsWith('/doctor')) return 'clinician';
  if (pathname.startsWith('/admin')) return 'platform_admin';
  if (pathname.startsWith('/analytics')) return 'platform_admin';
  return undefined;
}

export function Nav() {
  const pathname = usePathname() ?? '';
  const { data } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  if (HIDE_ON.some((r) => pathname.startsWith(r))) return null;

  const role = data?.user?.role ?? roleFromPath(pathname);
  const groups = itemsFor(role);
  return (
    <aside className="w-72 shrink-0 bg-navy text-white shadow-xl shadow-navy/25 max-md:w-full">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto border-r border-white/10 p-5 max-md:h-auto max-md:border-b max-md:border-r-0">
        <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-white">
          <span className="grid size-9 place-items-center rounded-md bg-teal text-navy shadow-sm shadow-teal/20">
            <HeartPulse size={20} aria-hidden />
          </span>
          A-health
        </Link>
        <p className="mt-2 text-xs capitalize text-slate-300">{role?.replace('_', ' ') ?? 'Staff workspace'}</p>

        <nav className="mt-6 flex-1 max-md:flex max-md:gap-5 max-md:overflow-x-auto max-md:pb-2">
          {groups.map((group) => (
            <div key={group.label} className="mb-6 max-md:mb-2 max-md:min-w-48">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[0.95rem] transition-colors focus-visible:outline-teal ${
                      active ? 'bg-teal text-navy font-semibold shadow-sm shadow-teal/20' : 'text-slate-300 hover:bg-navy-lift hover:text-white'
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

        <button
          type="button"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              const response = await fetch('/api/logout', { method: 'POST' });
              if (!response.ok) throw new Error('logout failed');
              await signOut({ redirect: false, callbackUrl: '/login' });
              window.location.assign('/login');
            } catch {
              setSignOutError('Sign out could not reach the authentication service. Try again.');
              setSigningOut(false);
            }
          }}
          className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[0.95rem] text-slate-300 transition-colors hover:bg-navy-lift hover:text-white focus-visible:outline-teal"
        >
          <LogOut size={17} aria-hidden />
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
        {signOutError && <p role="alert" className="mt-2 px-3 text-xs text-red-200">{signOutError}</p>}
      </div>
    </aside>
  );
}
