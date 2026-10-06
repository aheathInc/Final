import { requireRole } from '@/lib/roles';
import { serverGet } from '@/lib/serverToken';
import { PageHeader, PageShell } from '@/components/ui';
import { AuditLedgerPanel } from '@/components/AuditLedgerPanel';

interface AuditEvent {
  seq: string;
  category: 'consent' | 'verification' | 'break_glass';
  event_type: string;
  actor_id: string | null;
  resource_type: string;
  resource_id: string | null;
  occurred_at: string;
  details: Record<string, string>;
}

export default async function AuditLedgerPage() {
  await requireRole(['platform_admin']);
  const result = await serverGet<{ data: AuditEvent[] }>('/audit/ledger?limit=100');

  return (
    <PageShell>
      <PageHeader
        title="Identity and consent audit ledger"
        lede="Review consent, clinician verification and emergency break-glass events. Verification checks the full internal hash chain."
      />
      <AuditLedgerPanel events={result?.data ?? []} unavailable={!result} />
    </PageShell>
  );
}
