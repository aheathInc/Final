'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Button, Notice } from './ui';

export function RevokeDevice({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true); setError(null);
    try {
      await api.post(`/devices/${deviceId}/revoke`, {});
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Haikuweza kufutwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3">
      {!confirming ? (
        <Button variant="quiet" onClick={() => setConfirming(true)}>Futa kifaa</Button>
      ) : (
        <div>
          <p className="text-sm">
            Kikifutwa, hakitaweza kutuma taarifa wala kuita dharura. Siri yake itakuwa batili.
          </p>
          <div className="mt-2 flex gap-3">
            <Button variant="danger" onClick={revoke} disabled={busy}>Thibitisha</Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>Ghairi</Button>
          </div>
        </div>
      )}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
