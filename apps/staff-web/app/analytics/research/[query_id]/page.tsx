import Link from 'next/link';
import { requireRole } from '@/lib/roles';
export default async function LegacyResearchQueryPage() {
  await requireRole(['platform_admin','researcher']);
  return <div className="staff-page ahp-page"><h1>Use an approved research project</h1><p>Legacy query results are not released without current project authorization.</p><Link href="/analytics/research">Open governed Research Portal</Link></div>;
}
