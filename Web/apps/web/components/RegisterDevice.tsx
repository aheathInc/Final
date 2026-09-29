'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, inputClass } from './ui';

const TYPES = [
  { value: 'wearable_watch', label: 'Saa ya mkononi' },
  { value: 'vehicle_sensor', label: 'Kitambuzi cha gari' },
  { value: 'bp_monitor', label: 'Kipima shinikizo' },
  { value: 'glucometer', label: 'Kipima sukari' },
  { value: 'pulse_oximeter', label: 'Kipima oksijeni' },
];

export function RegisterDevice() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('wearable_watch');
  const [serial, setSerial] = useState('');
  const [label, setLabel] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ device_credential: string }>('/devices', {
        device_type: type,
        serial_number: serial,
        label: label || undefined,
        vehicle_registration: type === 'vehicle_sensor' ? vehicle || undefined : undefined,
      }, idem());
      setCredential(res.data.device_credential);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Kifaa hakikusajiliwa. Huenda namba hii tayari ipo.'));
    } finally { setBusy(false); }
  }

  if (credential) {
    return (
      <div className="mt-4 border-l-4 border-amber bg-paper-sunk p-4">
        <p className="font-medium text-amber">Nakili siri hii sasa</p>
        {/*
          Shown once and never again. A secret that can raise an emergency is
          not one worth keeping recoverable — losing it means re-registering,
          which is the correct trade.
        */}
        <p className="mt-1 text-sm">
          Haitaonyeshwa tena. Ikipotea, itabidi usajili kifaa upya.
        </p>
        <p className="mt-3 break-all font-mono text-sm">{credential}</p>
        <Button variant="quiet" onClick={() => { setCredential(null); setOpen(false); setSerial(''); setLabel(''); }}
          className="mt-3">
          Nimenakili
        </Button>
      </div>
    );
  }

  if (!open) {
    return <div className="mt-4"><Button onClick={() => setOpen(true)}>Sajili kifaa</Button></div>;
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border border-line bg-white p-4">
      <Field label="Aina" htmlFor="t">
        <select id="t" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Namba ya kifaa" htmlFor="s">
        <input id="s" required value={serial} onChange={(e) => setSerial(e.target.value)} className={inputClass} />
      </Field>
      {type === 'vehicle_sensor' && (
        <Field label="Namba ya gari" htmlFor="v">
          <input id="v" value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={inputClass} />
        </Field>
      )}
      <Field label="Jina la utambulisho" htmlFor="l">
        <input id="l" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !serial.trim()}>Sajili</Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
      </div>
    </form>
  );
}
