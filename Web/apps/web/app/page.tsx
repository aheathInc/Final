import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { homeForRole } from '@/lib/roles';

export default async function Index() {
  const session = await getServerSession(authOptions);
  redirect(session ? homeForRole(session.user?.role) : '/login');
}
