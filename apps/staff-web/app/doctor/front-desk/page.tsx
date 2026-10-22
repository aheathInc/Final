import { requireRole } from '@/lib/roles';
import { FrontDeskWorkspace } from '@/components/FrontDeskWorkspace';
export default async function FrontDeskPage() {
  await requireRole(['clinician']);
  return <FrontDeskWorkspace mode="clinical" />;
}
