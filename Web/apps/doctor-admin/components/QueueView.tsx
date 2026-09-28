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
      setError('Foleni haikuweza kupakiwa. Inajaribu tena yenyewe.');
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
      router.push(`/case/${id}`);
    } catch (e) {
      setError(errorMessage(e, 'Kesi haikukubaliwa. Huenda mtu mwingine amekwisha ichukua.'));
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
      setError(errorMessage(e, 'Ombi la kukataa halikufanikiwa.'));
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-[#dfe8e1] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[#789087]">Mwonekano</p>
          <p className="mt-1 text-lg font-semibold text-ink">{scope === 'offered' ? 'Kesi zinazosubiri' : 'Kesi zangu'}</p>
        </div>
        <div className="rounded-2xl border border-[#dfe8e1] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[#789087]">Idadi sasa</p>
          <p className="mt-1 text-lg font-semibold text-petrol">{loading ? '—' : entries.length}</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-[#d8e2db] bg-[#e5eee8] p-1 sm:max-w-md">
        {(['offered', 'mine'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={`min-h-10 flex-1 rounded-lg px-4 text-[0.9rem] transition-colors ${
              scope === s ? 'bg-white font-semibold text-petrol shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}>
            {s === 'offered' ? 'Zinasubiri jibu' : 'Zangu'}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {loading ? <Loading /> : entries.length === 0 ? (
        <Empty>
          {scope === 'offered' ? 'Hakuna kesi inayosubiri kwa sasa.' : 'Huna kesi unayoshughulikia.'}
        </Empty>
      ) : (
        <ul className="mt-4 grid gap-4 lg:grid-cols-2">
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
