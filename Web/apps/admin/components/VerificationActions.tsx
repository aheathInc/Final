'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice, areaClass } from './ui';

/**
 * Rejection demands a reason and approval does not, because the two are not
 * symmetric: an approved clinician gets to practise, while a rejected one is
 * owed an explanation they can act on — and the platform is owed a record of
 * why someone was refused.
 */
export function VerificationActions({ clinicianId }: { clinicianId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) {
      setError('Sababu inahitajika unapokataa.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.post(`/clinicians/${clinicianId}/verification`,
        { decision, ...(decision === 'reject' ? { reason } : {}) }, idem());
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Uamuzi haukuhifadhiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4">
      {!rejecting ? (
        <div className="flex gap-3">
          <Button onClick={() => decide('approve')} disabled={busy}>Idhinisha</Button>
          <Button variant="quiet" onClick={() => setRejecting(true)} disabled={busy}>Kataa</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Kwa nini unakataa leseni hii?" className={areaClass} />
          <div className="flex gap-3">
            <Button variant="danger" onClick={() => decide('reject')} disabled={busy || !reason.trim()}>
              Thibitisha kukataa
            </Button>
            <Button variant="quiet" onClick={() => setRejecting(false)}>Ghairi</Button>
          </div>
        </div>
      )}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
