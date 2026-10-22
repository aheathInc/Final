import { requireRole } from '@/lib/roles';
import { FrontDeskWorkspace } from '@/components/FrontDeskWorkspace';
export default async function FrontDeskAdminPage() {
  await requireRole(['platform_admin']);
  return <FrontDeskWorkspace mode="administration" />;
}
