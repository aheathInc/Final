'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice } from './ui';

/**
 * Only two conditions are scored, and the backend skips anything else rather
 * than inventing a number. Saying that here stops a clinician wondering why a
 * third condition never appears.
 */
export function ComputeRisk({ patientProfileId }: { patientProfileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compute() {
    setBusy(true); setError(null);
    try {
      await api.post(`/patient-profiles/${patientProfileId}/risk-scores/compute`, {}, idem());
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Hesabu haikufanikiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4">
      <Button variant="quiet" onClick={compute} disabled={busy}>
        {busy ? 'Inahesabu...' : 'Hesabu upya alama za hatari'}
      </Button>
      <p className="mt-1 text-xs text-ink-soft">
        Shinikizo la damu na kisukari cha aina ya pili pekee ndizo zinazohesabiwa kwa sasa.
      </p>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
