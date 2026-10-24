import { requireRole } from '@/lib/roles';
import { ResearchPortal } from '@/components/research/ResearchPortal';
export default async function ResearchGovernancePage() {
  const session=await requireRole(['platform_admin','facility_admin']);
  return <div className="staff-page ahp-page"><ResearchPortal key={session.user?.id ?? session.user?.email ?? 'no-session'} role={session.user?.role ?? ''}/></div>;
}
