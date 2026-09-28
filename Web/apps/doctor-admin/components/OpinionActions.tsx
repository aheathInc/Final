'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Notice, areaClass } from './ui';

/**
 * First claim wins — the backend resolves that with a conditional update, so
 * two specialists opening the list at once cannot both take the same question.
 * Only the one who claimed it can answer.
 */
export function OpinionActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true); setError(null);
    try {
      await api.post(`/network/second-opinions/${id}/claim`, {}, idem());
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Swali hili limekwisha chukuliwa na mtu mwingine.'));
    } finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/network/second-opinions/${id}/answer`, { answer }, idem());
      setAnswering(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Jibu halikutumwa.'));
    } finally { setBusy(false); }
  }

  if (status === 'answered') return null;

  return (
    <div className="mt-3">
      {status === 'open' && <Button onClick={claim} disabled={busy}>Chukua swali hili</Button>}

      {status === 'claimed' && !answering && (
        <Button onClick={() => setAnswering(true)}>Jibu</Button>
      )}

      {answering && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <textarea rows={4} required value={answer} onChange={(e) => setAnswer(e.target.value)}
            placeholder="Andika maoni yako..." className={areaClass} />
          <div className="flex gap-3">
            <Button type="submit" disabled={busy || !answer.trim()}>Tuma jibu</Button>
            <Button type="button" variant="quiet" onClick={() => setAnswering(false)}>Ghairi</Button>
          </div>
        </form>
      )}

      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  );
}
