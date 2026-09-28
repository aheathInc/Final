'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, Notice, inputClass } from './ui';
import { dateTime } from '@/lib/format';

interface Result {
  pharmacy: { id: string; name: string; distance_km: number | null };
  medication_name: string;
  stock_status: string;
  unit_price: number | null;
  currency: string | null;
  last_reported_at: string;
}

export function MedicationSearch() {
  const [name, setName] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // Dar es Salaam centre as a default origin; a real deployment would use
      // the clinician's facility or the patient's region.
      const res = await api.get<{ data: Result[] }>('/pharmacies/medication-search', {
        params: { medication_name: name, lat: -6.8, lng: 39.28, radius_km: 20 },
      });
      setResults(res.data.data ?? []);
    } catch (e) {
      setError(errorMessage(e, 'Utafutaji haukufanikiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <Field label="Jina la dawa" htmlFor="m">
            <input id="m" required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Amoxicillin" className={inputClass} />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>Tafuta</Button>
      </form>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {results !== null && (
        results.length === 0 ? (
          <p className="mt-6 text-ink-soft">Hakuna duka lililoripoti dawa hii karibu.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {results.map((r, i) => (
              <li key={i}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="font-medium">{r.pharmacy.name}</span>
                    {r.pharmacy.distance_km !== null && (
                      <span className="text-sm text-ink-soft">{r.pharmacy.distance_km.toFixed(1)} km</span>
                    )}
                  </div>
                  <p className="mt-1 text-[0.95rem]">
                    {r.medication_name} · {r.stock_status === 'in_stock' ? 'ipo'
                      : r.stock_status === 'low_stock' ? 'imebaki kidogo' : 'imeisha'}
                    {r.unit_price ? ` · ${r.unit_price} ${r.currency ?? ''}` : ''}
                  </p>
                  {/* Stock data ages fast; a stale figure sends someone on a
                      journey for nothing, so the age travels with the answer. */}
                  <p className="mt-1 text-xs text-ink-soft">
                    Iliripotiwa {dateTime(r.last_reported_at)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
