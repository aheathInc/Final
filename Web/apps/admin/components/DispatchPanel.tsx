'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem, type EmergencyRequest, type Facility, type TransportUnit } from '@/lib/api';
import { Button, Field, Notice, inputClass } from './ui';
import { STATUS_LABEL, canDispatch, nextStatuses } from '@/lib/emergency';

const OUTCOMES = [
  { value: 'transported', label: 'Amepelekwa hospitali' },
  { value: 'treated_on_scene', label: 'Ametibiwa hapo hapo' },
  { value: 'refused_care', label: 'Amekataa msaada' },
  { value: 'false_alarm', label: 'Taarifa ya uongo' },
  { value: 'deceased', label: 'Amefariki' },
];

/**
 * Dispatch and status change are two different actions because they are two
 * different facts. Dispatch needs a real unit and a real destination; the
 * status endpoint cannot produce "dispatched" at all, so the board can never
 * claim a crew is on the way when none was assigned.
 */
export function DispatchPanel({
  emergency, units, facilities,
}: { emergency: EmergencyRequest; units: TransportUnit[]; facilities: Facility[] }) {
  const router = useRouter();
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('transported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = nextStatuses(emergency.status);
  const dispatchable = canDispatch(emergency.status);

  async function dispatch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/emergency-requests/${emergency.id}/dispatch`,
        { transport_unit_id: unitId, destination_facility_id: facilityId }, idem());
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Gari halikutumwa. Huenda limekwisha chukuliwa.'));
    } finally { setBusy(false); }
  }

  async function changeStatus(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/emergency-requests/${emergency.id}/status`,
        { status, ...(status === 'resolved' ? { outcome } : {}) }, idem());
      setStatus('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Hali haikubadilishwa.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {dispatchable && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Tuma gari</h2>
          {units.length === 0 ? (
            <p className="mt-3 text-[0.95rem] text-amber">
              Hakuna gari linalopatikana karibu. Angalia orodha ya magari kabla ya kuendelea.
            </p>
          ) : (
            <form onSubmit={dispatch} className="mt-3 flex flex-col gap-3">
              <Field label="Gari" htmlFor="u">
                <select id="u" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.call_sign} · {u.capability}
                      {u.distance_km !== null ? ` · ${u.distance_km.toFixed(1)} km` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kituo cha kupelekwa" htmlFor="f">
                <select id="f" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputClass}>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
              {/*
                Named here because it is a real consequence: when the patient
                is known, dispatching releases their allergies and conditions
                to the receiving facility, and that access is always audited.
              */}
              {emergency.patient_profile_id && (
                <p className="text-xs text-ink-soft">
                  Mgonjwa anajulikana. Kutuma gari kutatoa mzio na magonjwa sugu yake kwa kituo
                  kinachopokea, na ufikiaji huo utaandikwa kwenye kumbukumbu.
                </p>
              )}
              <Button type="submit" disabled={busy || !unitId || !facilityId} className="self-start">
                {busy ? 'Inatuma...' : 'Tuma gari'}
              </Button>
            </form>
          )}
        </section>
      )}

      {allowed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Badilisha hali</h2>
          <form onSubmit={changeStatus} className="mt-3 flex flex-col gap-3">
            <Field label="Hali mpya" htmlFor="s">
              <select id="s" required value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                <option value="">Chagua...</option>
                {allowed.map((a) => <option key={a} value={a}>{STATUS_LABEL[a]}</option>)}
              </select>
            </Field>
            {/* Closing without an outcome is refused by the backend, so the
                field appears rather than the submit failing later. */}
            {status === 'resolved' && (
              <Field label="Matokeo" htmlFor="o">
                <select id="o" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
                  {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
            <Button type="submit" disabled={busy || !status} className="self-start">Hifadhi</Button>
          </form>
        </section>
      )}

      {error && <Notice>{error}</Notice>}
    </div>
  );
}
