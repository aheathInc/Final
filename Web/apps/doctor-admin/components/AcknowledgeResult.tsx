'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Button, Notice } from './ui';

/**
 * Until a clinician acknowledges, a critical finding is not treated as
 * received. Silence is never counted as receipt — which is the whole point of
 * having this step rather than marking a result read when a page loads.
 */
export function AcknowledgeResult({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ack() {
    setBusy(true); setError(null);
    try {
      await api.post(`/investigation-orders/${orderId}/acknowledge`, {});
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Haikuweza kuthibitishwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <Button onClick={ack} disabled={busy}>
        {busy ? 'Inathibitisha...' : 'Thibitisha nimepokea matokeo'}
      </Button>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
