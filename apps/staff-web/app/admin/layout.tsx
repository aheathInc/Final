import { requireRole } from '@/lib/roles';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['platform_admin', 'dispatcher', 'facility_admin']);
  return children;
}
