'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, Notice, inputClass } from './ui';
import { dateTime } from '@/lib/format';

interface Result {
  pharmacy: { id: string; name: string; distance_km: number | null };
  medication_name: string;
  stock_status: string;
  quantity_on_hand: number | null;
  fulfillment_status: string;
  unit_price: number | null;
  currency: string | null;
  last_reported_at: string;
}

export function MedicationSearch() {
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const lat = latitude.trim() ? Number(latitude) : undefined;
      const lng = longitude.trim() ? Number(longitude) : undefined;
      if ((lat === undefined) !== (lng === undefined) ||
          (lat !== undefined && (Number.isNaN(lat) || Math.abs(lat) > 90)) ||
          (lng !== undefined && (Number.isNaN(lng) || Math.abs(lng) > 180))) {
        setError('Enter both valid coordinates to rank by distance, or leave both blank for an unranked list.');
        return;
      }
      const res = await api.get<{ data: Result[] }>('/pharmacies/medication-search', {
        params: { medication_name: name, ...(lat !== undefined ? { lat, lng } : {}) },
      });
      setResults(res.data.data ?? []);
    } catch (e) {
      setError(errorMessage(e, 'Medication search failed.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <Field label="Medication name" htmlFor="m">
            <input id="m" required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Amoxicillin" className={inputClass} />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Searching...' : 'Search'}</Button>
      </form>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Latitude (optional)" htmlFor="pharmacy-latitude"><input id="pharmacy-latitude" inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="Use an explicitly supplied location" className={inputClass} /></Field>
        <Field label="Longitude (optional)" htmlFor="pharmacy-longitude"><input id="pharmacy-longitude" inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="Leave both blank to skip distance ranking" className={inputClass} /></Field>
      </div>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {results !== null && (
        results.length === 0 ? (
          <p className="mt-6 text-ink-soft">No nearby pharmacy has reported this medication.</p>
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
                    {r.medication_name} · {r.fulfillment_status.replace(/_/g, ' ')} · {r.quantity_on_hand === null ? 'quantity unknown' : `${r.quantity_on_hand} on hand`}
                    {r.unit_price ? ` · ${r.unit_price} ${r.currency ?? ''}` : ''}
                  </p>
                  {/* Stock data ages fast; a stale figure sends someone on a
                      journey for nothing, so the age travels with the answer. */}
                  <p className="mt-1 text-xs text-ink-soft">
                    Reported {dateTime(r.last_reported_at)}. Availability is time-sensitive and is not a reservation.
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
