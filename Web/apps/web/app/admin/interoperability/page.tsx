import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/roles';
import { serverGet } from '@/lib/serverToken';
import { InteropConsole } from '@/components/InteropConsole';

type Facility = { id: string; name: string };
type FacilitiesPage = { data: Facility[]; meta?: { next_cursor?: string | null } };

export default async function InteroperabilityAdminPage() {
  await requireRole(['platform_admin']);
  const facilities = await serverGet<FacilitiesPage>('/facilities?limit=100');
  if (!facilities) redirect('/admin/dashboard');
  return <InteropConsole facilities={facilities.data ?? []} />;
}
