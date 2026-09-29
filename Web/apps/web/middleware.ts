import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { sessionCookieName } from './lib/authCookies';

const PUBLIC = ['/login', '/api/auth'];

function homeFor(role?: string) {
  if (role === 'clinician') return '/doctor/queue';
  if (role === 'platform_admin') return '/admin/dashboard';
  if (role === 'dispatcher') return '/admin/emergency';
  if (role === 'facility_admin') return '/admin/facilities';
  if (role === 'researcher') return '/analytics/surveillance';
  return '/login';
}

function allowed(path: string, role?: string) {
  if (path.startsWith('/doctor')) return role === 'clinician';
  if (path.startsWith('/admin')) return ['platform_admin', 'dispatcher', 'facility_admin'].includes(role ?? '');
  if (path.startsWith('/analytics')) return ['platform_admin', 'researcher'].includes(role ?? '');
  return true;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((prefix) => path.startsWith(prefix)) || path.startsWith('/_next')) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName });
  const role = token?.role as string | undefined;

  if (path === '/') return NextResponse.redirect(new URL(homeFor(role), req.url));
  if (!token) return NextResponse.redirect(new URL('/login', req.url));
  if (!allowed(path, role)) return NextResponse.redirect(new URL(homeFor(role), req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
