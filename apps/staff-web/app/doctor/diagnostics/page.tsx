import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { serverGet } from '@/lib/serverToken';
import type { InvestigationOrder, Page } from '@/lib/api';
import { Notice, PageHeader, PageShell } from '@/components/ui';
import { DiagnosticsTable } from '@/components/premium/DiagnosticsTable';

export default async function DiagnosticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const page = await serverGet<Page<InvestigationOrder>>('/investigation-orders?limit=50');
  const orders = page?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Lab orders & results"
        lede="Critical results are prioritised. A result is not treated as received until it is acknowledged."
      />

      {!page ? <Notice>Unable to load diagnostic orders. This is not an empty result list.</Notice> : <DiagnosticsTable orders={orders}/>}

    </PageShell>
  );
}
