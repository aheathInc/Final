import Link from 'next/link';
import { requireRole } from '@/lib/roles';
import { serverGet } from '@/lib/serverToken';
import type { InvestigationOrder } from '@/lib/api';
import { Notice, PageShell } from '@/components/ui';
import { LabOrderWorkspace } from '@/components/LabOrderWorkspace';

export default async function LabOrderPage({ params }: { params: { order_id: string } }) {
  await requireRole(['lab_technician']);
  if (!/^[0-9a-f-]{36}$/i.test(params.order_id)) return <PageShell><Notice>Invalid order reference.</Notice></PageShell>;
  const order = await serverGet<InvestigationOrder>(`/investigation-orders/${params.order_id}`);
  return <PageShell className="min-w-0 overflow-x-clip">
    <Link href="/lab" className="text-petrol underline underline-offset-4">Back to laboratory orders</Link>
    {order ? <LabOrderWorkspace initialOrder={order} /> : <Notice>This order could not be loaded. Check your laboratory assignment or return to the order list and retry.</Notice>}
  </PageShell>;
}
