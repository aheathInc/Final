'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem, type DeclineReason, type Page, type QueueEntry } from '@/lib/api';
import { Empty, Loading, Notice } from './ui';
import { QueueCard } from './QueueCard';

const REFRESH_MS = 15000;

export function QueueView() {
  const router = useRouter();
  const [scope, setScope] = useState<'offered' | 'mine'>('offered');
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Page<QueueEntry>>('/queue', { params: { scope, limit: 50 } });
      setEntries(res.data?.data ?? []);
      setError(null);
    } catch {
      setError('The queue could not be loaded. It will retry automatically.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Polling, not websockets: messaging has a realtime channel, the queue does
  // not, and a fifteen-second poll is honest about that rather than
  // pretending to be live.
  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function accept(id: string) {
    setBusyId(id);
    try {
      await api.post(`/consultations/${id}/accept`, {}, idem());
      setEntries((l) => l.filter((e) => e.consultation.id !== id));
      // Straight into the case: the clinician accepted in order to start, not
      // in order to go looking for it in another tab.
      router.push(`/doctor/case/${id}`);
    } catch (e) {
      setError(errorMessage(e, 'This case could not be accepted. Another clinician may have taken it.'));
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function decline(id: string, reason: DeclineReason) {
    setBusyId(id);
    try {
      await api.post(`/consultations/${id}/decline`, { reason }, idem());
      setEntries((l) => l.filter((e) => e.consultation.id !== id));
    } catch (e) {
      setError(errorMessage(e, 'The decline request did not complete.'));
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-line bg-paper-sunk/60 px-3 pt-3">
        {(['offered', 'mine'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={`min-h-11 rounded-t-md px-4 text-[0.95rem] transition-colors ${
              scope === s ? 'border-b-2 border-petrol bg-white font-semibold text-petrol shadow-sm' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
            }`}>
            {s === 'offered' ? 'Offered to me' : 'My active cases'}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {loading ? <Loading /> : entries.length === 0 ? (
        <Empty>
          {scope === 'offered' ? 'No offered cases are waiting right now.' : 'You do not have active cases assigned.'}
        </Empty>
      ) : (
        <ul className="grid gap-3 p-4 lg:grid-cols-2">
          {entries.map((e) => (
            <li key={e.consultation.id}>
              <QueueCard entry={e} scope={scope} busy={busyId === e.consultation.id}
                onAccept={accept} onDecline={decline} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
