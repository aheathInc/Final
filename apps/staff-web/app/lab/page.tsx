import { requireRole } from '@/lib/roles';
import { PageHeader, PageShell } from '@/components/ui';
import { LabWorkspace } from '@/components/LabWorkspace';

export default async function LabPage() {
  await requireRole(['lab_technician']);

  return (
    <PageShell className="min-w-0 overflow-x-clip">
      <PageHeader title="Laboratory workspace" lede="Receive samples and submit results for orders sent to your laboratory." />
      <LabWorkspace />
    </PageShell>
  );
}
