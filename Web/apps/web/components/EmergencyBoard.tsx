'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type EmergencyRequest, type Page } from '@/lib/api';
import { Badge, Card, Empty, Loading, Notice } from './ui';
import { STATUS_LABEL, emergencyAccent } from '@/lib/emergency';
import { dateTime } from '@/lib/format';

const REFRESH_MS = 10000;
const OPEN = ['reported', 'triaged', 'dispatched', 'en_route', 'arrived'];

export function EmergencyBoard() {
  const [items, setItems] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Page<EmergencyRequest>>('/emergency-requests', { params: { limit: 100 } });
      setItems(res.data?.data ?? []);
      setError(null);
    } catch {
      setError('The emergency board could not be loaded. It will retry automatically.');
    } finally { setLoading(false); }
  }, []);

  // Ten seconds, not fifteen: this is the one board someone watches for a
  // whole shift, and a minute-old picture of an ambulance is not a picture.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const open = items.filter((e) => OPEN.includes(e.status));
  const closed = items.filter((e) => !OPEN.includes(e.status));
  const shown = showClosed ? closed : open;

  return (
    <div>
      <div className="mt-6 flex gap-1 border-b border-line bg-paper-sunk/60 px-3 pt-3">
        <button onClick={() => setShowClosed(false)}
          className={`min-h-11 rounded-t-md px-4 text-[0.95rem] ${
            !showClosed ? 'border-b-2 border-petrol bg-white font-semibold text-petrol shadow-sm' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
          }`}>
          Active ({open.length})
        </button>
        <button onClick={() => setShowClosed(true)}
          className={`min-h-11 rounded-t-md px-4 text-[0.95rem] ${
            showClosed ? 'border-b-2 border-petrol bg-white font-semibold text-petrol shadow-sm' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
          }`}>
          Closed ({closed.length})
        </button>
      </div>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {loading ? <Loading /> : shown.length === 0 ? (
        <Empty>{showClosed ? 'No closed emergency requests.' : 'No active emergency requests.'}</Empty>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.map((e) => (
            <li key={e.id}>
              <Card accent={emergencyAccent(e)}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/admin/emergency/${e.id}`} className="font-medium text-petrol underline underline-offset-4">
                    {e.scale === 'mass_casualty' ? 'Mass casualty' : 'Individual'} · {e.category.replace(/_/g, ' ')}
                  </Link>
                  <Badge tone={OPEN.includes(e.status) ? 'attention' : 'neutral'}>{STATUS_LABEL[e.status]}</Badge>
                </div>
                {e.description && <p className="mt-1 text-[0.95rem]">{e.description}</p>}
                <p className="mt-1 text-sm text-ink-soft">
                  {dateTime(e.reported_at)} · {e.source}
                  {e.estimated_casualties ? ` · people ${e.estimated_casualties}` : ''}
                  {' · '}
                  <span className="font-mono tabular-nums">
                    {e.location.lat.toFixed(4)}, {e.location.lng.toFixed(4)}
                  </span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
