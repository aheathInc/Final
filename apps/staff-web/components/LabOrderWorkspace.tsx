'use client';

import { useRef, useState } from 'react';
import { api, errorMessage, idem, type InvestigationOrder } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Field, Notice, areaClass, inputClass } from './ui';

type ResultRow = { analyte: string; value: string; unit: string; reference_low: string; reference_high: string; critical_low: string; critical_high: string };
const blank = (): ResultRow => ({ analyte: '', value: '', unit: '', reference_low: '', reference_high: '', critical_low: '', critical_high: '' });
const bounds = ['reference_low', 'reference_high', 'critical_low', 'critical_high'] as const;
const labels = { reference_low: 'Reference low', reference_high: 'Reference high', critical_low: 'Critical low', critical_high: 'Critical high' };

export function LabOrderWorkspace({ initialOrder }: { initialOrder: InvestigationOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const [rows, setRows] = useState<ResultRow[]>([blank()]);
  const [narrative, setNarrative] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; options: ReturnType<typeof idem> }>();
  async function act(action: string, body: object) {
    setBusy(true); setError(null); setSaved(null);
    const fingerprint = action + JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, options: idem() };
    try {
      const response = await api.post<InvestigationOrder>(`/investigation-orders/${order.id}/${action}`, body, attempt.current.options);
      setOrder(response.data);
      setSaved(action === 'collect' ? 'Sample receipt recorded.' : 'Results submitted. The ordering clinician can now review them.');
    } catch (cause) { setError(errorMessage(cause, 'The update could not be confirmed. Retry the same submission or reload the order.')); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError(null);
    try { setOrder((await api.get<InvestigationOrder>(`/investigation-orders/${order.id}`)).data); }
    catch (cause) { setError(errorMessage(cause, 'Could not reload this order. Return to the list and retry.')); }
    finally { setBusy(false); }
  }
  function change(index: number, key: keyof ResultRow, value: string) {
    setRows(previous => previous.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const values = rows.map(row => ({ analyte: row.analyte.trim(), value: row.value.trim(), unit: row.unit.trim() || undefined,
      ...Object.fromEntries(bounds.filter(key => row[key].trim() !== '').map(key => [key, Number(row[key])])) }));
    if (values.some(row => !row.analyte || !row.value || bounds.some(key => key in row && !Number.isFinite((row as Record<string, unknown>)[key])))) {
      setError('Enter an analyte and value for every row, and valid numbers for any ranges.'); return;
    }
    void act('results', { base_version: order.version, values, narrative: narrative.trim() || undefined });
  }
  return <div className="mt-5 space-y-5">
    <header><h1 className="text-2xl font-semibold">{order.investigation_code}</h1><p className="mt-2 text-ink-soft">{order.patient_name} · {order.facility_name}</p>
      <p className="mt-2 break-all text-sm text-ink-soft">Patient reference: {order.patient_profile_id}</p>
      <p className="mt-2 text-sm text-ink-soft">Ordered {dateTime(order.ordered_at)} · {order.urgency}</p>
      <div className="mt-3"><Badge tone={order.is_critical ? 'problem' : 'neutral'}>{order.is_critical ? 'Critical · ' : ''}{order.status === 'collected' ? 'Sample received' : order.status}</Badge></div>
    </header>
    {order.clinical_notes && <Card><h2 className="font-semibold">Order notes</h2><p className="mt-2 whitespace-pre-wrap">{order.clinical_notes}</p></Card>}
    {error && <Notice>{error}</Notice>}{saved && <p role="status" className="text-petrol">{saved}</p>}
    <div className="flex flex-wrap gap-3">
      {['ordered', 'scheduled'].includes(order.status) && <Button disabled={busy} onClick={() => void act('collect', { base_version: order.version })}>Confirm sample received</Button>}
      <Button disabled={busy} variant="quiet" onClick={() => void reload()}>Reload order</Button>
    </div>
    {order.status === 'collected' && <form onSubmit={submit} className="space-y-5">
      <h2 className="text-xl font-semibold">Enter results</h2>
      <p className="max-w-prose text-sm text-ink-soft">Use the values, units and applicable ranges from the laboratory report. No ranges are prefilled.</p>
      {rows.map((row, i) => <fieldset key={i} disabled={busy} className="ahp-card min-w-0 p-5"><legend className="px-2 font-semibold">Result {i + 1}</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Analyte" htmlFor={`analyte-${i}`}><input id={`analyte-${i}`} required maxLength={120} className={inputClass} value={row.analyte} onChange={e => change(i, 'analyte', e.target.value)} /></Field>
          <Field label="Value" htmlFor={`value-${i}`}><input id={`value-${i}`} required maxLength={200} className={inputClass} value={row.value} onChange={e => change(i, 'value', e.target.value)} /></Field>
          <Field label="Unit (optional)" htmlFor={`unit-${i}`}><input id={`unit-${i}`} maxLength={40} className={inputClass} value={row.unit} onChange={e => change(i, 'unit', e.target.value)} /></Field>
          {bounds.map(key => <Field key={key} label={`${labels[key]} (optional)`} htmlFor={`${key}-${i}`}><input id={`${key}-${i}`} type="number" step="any" className={inputClass} value={row[key]} onChange={e => change(i, key, e.target.value)} /></Field>)}
        </div>
        {rows.length > 1 && <div className="mt-4"><Button type="button" variant="quiet" onClick={() => setRows(previous => previous.filter((_, index) => index !== i))}>Remove result {i + 1}</Button></div>}
      </fieldset>)}
      <Button type="button" variant="quiet" disabled={busy || rows.length >= 100} onClick={() => setRows(previous => [...previous, blank()])}>Add result row</Button>
      <Field label="Report notes (optional)" htmlFor="lab-narrative"><textarea id="lab-narrative" rows={4} maxLength={4000} disabled={busy} className={areaClass} value={narrative} onChange={e => setNarrative(e.target.value)} /></Field>
      <p className="text-sm text-ink-soft">Submission finalizes this report. Results cannot be edited from this workspace afterward.</p>
      <Button disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit results'}</Button>
    </form>}
    {order.values.length > 0 && <section aria-label="Submitted results" className="ahp-card p-0"><div className="ahp-table-wrap"><table><thead><tr><th>Analyte</th><th>Value</th><th>Reference range</th><th>Reported flag</th></tr></thead>
      <tbody>{order.values.map((v, i) => <tr key={i}><td>{v.analyte}</td><td>{v.value} {v.unit}</td><td>{v.reference_low ?? '—'} – {v.reference_high ?? '—'}</td><td>{v.flag.replace(/_/g, ' ')}</td></tr>)}</tbody></table></div>
      {order.narrative && <p className="whitespace-pre-wrap p-5">{order.narrative}</p>}
      <p className="p-5 text-sm text-ink-soft">{order.status === 'acknowledged' ? 'Acknowledged by the ordering clinician.' : 'Awaiting acknowledgement by the ordering clinician.'}</p>
    </section>}
  </div>;
}
