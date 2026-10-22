import { requireRole } from '@/lib/roles';

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['platform_admin', 'researcher']);
  return children;
}
