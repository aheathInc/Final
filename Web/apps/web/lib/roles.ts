import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';

export const ROLE_HOME: Record<string, string> = {
  clinician: '/doctor/queue',
  dispatcher: '/admin/emergency',
  facility_admin: '/admin/facilities',
  platform_admin: '/admin/dashboard',
  researcher: '/analytics/surveillance',
};

export function homeForRole(role?: string | null) {
  return (role && ROLE_HOME[role]) || '/login';
}

export async function requireRole(roles: string[]) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!session) redirect('/login');
  if (!role || !roles.includes(role)) redirect(homeForRole(role));
  return session;
}
