'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type InvestigationOrder, type Page } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Button, Empty, Field, Loading, Notice, inputClass } from './ui';

export function LabWorkspace() {
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [orders, setOrders] = useState<InvestigationOrder[]>([]);
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  async function load(next?: string) {
    const run = ++generation.current;
    setBusy(true); setError(null);
    try {
      const [membership, response] = await Promise.all([
        api.get<{ data: typeof facilities }>('/laboratory/facilities'),
        api.get<Page<InvestigationOrder>>('/investigation-orders', { params: { limit: 25, status: status || undefined, cursor: next } }),
      ]);
      if (run !== generation.current) return;
      setFacilities(membership.data.data);
      setOrders(previous => next ? [...previous, ...response.data.data] : response.data.data);
      setCursor(response.data.meta?.next_cursor ?? null);
    } catch (cause) {
      if (run !== generation.current) return;
      setOrders([]); setCursor(null);
      setError(errorMessage(cause, 'Could not load laboratory orders. Retry when the service is available.'));
    } finally { if (run === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return <section aria-label="Laboratory orders">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <Field label="Order status" htmlFor="lab-status"><select id="lab-status" value={status} disabled={busy} onChange={e => setStatus(e.target.value)} className={inputClass}>
        <option value="">All statuses</option><option value="ordered">Awaiting sample</option><option value="collected">Sample received</option>
        <option value="resulted">Results submitted</option><option value="acknowledged">Acknowledged</option><option value="cancelled">Cancelled</option>
      </select></Field>
      <Button type="button" variant="quiet" disabled={busy} onClick={() => void load()}>Refresh orders</Button>
    </div>
    {error ? <Notice>{error}</Notice> : busy && !orders.length ? <Loading /> : <>
      <p className="mb-4 text-sm text-ink-soft">{facilities.length ? `Assigned laboratories: ${facilities.map(f => f.name).join(', ')}` : 'No active laboratory assignment. Ask a platform administrator to assign your account to a facility.'}</p>
      {!orders.length ? <Empty>{facilities.length ? 'No orders match this status in your assigned laboratories.' : 'Orders will appear after laboratory access is assigned.'}</Empty> :
        <><ul className="divide-y divide-line sm:hidden">{orders.map(o => <li key={o.id} className="space-y-2 py-5">
          <h2 className="break-words font-semibold">{o.patient_name ?? o.patient_profile_id}</h2>
          <p className="break-words">{o.investigation_code}</p><p className="text-sm text-ink-soft">{o.facility_name} · {o.urgency}</p>
          <Badge tone={o.is_critical ? 'problem' : 'neutral'}>{o.is_critical ? 'Critical · ' : ''}{o.status === 'collected' ? 'Sample received' : o.status}</Badge>
          <p className="text-sm text-ink-soft">{dateTime(o.ordered_at)}</p>
          <Link className="ahp-view-link" href={`/lab/${o.id}`}>Open order<span className="sr-only"> {o.investigation_code}</span></Link>
        </li>)}</ul>
        <div className="ahp-card hidden min-w-0 p-0 sm:block"><div className="ahp-table-wrap max-w-full" tabIndex={0} role="region" aria-label="Laboratory order table, scroll horizontally for all columns"><table className="!table min-w-[680px]"><thead><tr><th scope="col">Patient / order</th><th scope="col">Laboratory</th><th scope="col">Status</th><th scope="col">Ordered</th><th scope="col">Action</th></tr></thead><tbody>
          {orders.map(o => <tr key={o.id}><td><span className="ahp-row-title">{o.patient_name ?? o.patient_profile_id}</span><small className="ahp-row-secondary">{o.investigation_code} · {o.urgency}</small></td>
            <td>{o.facility_name}</td><td><Badge tone={o.is_critical ? 'problem' : 'neutral'}>{o.is_critical ? 'Critical · ' : ''}{o.status === 'collected' ? 'Sample received' : o.status}</Badge></td>
            <td>{dateTime(o.ordered_at)}</td><td><Link className="ahp-view-link" href={`/lab/${o.id}`}>Open<span className="sr-only"> {o.investigation_code}</span></Link></td></tr>)}
        </tbody></table></div></div></>}
      {cursor && <div className="mt-4"><Button disabled={busy} onClick={() => void load(cursor)}>Load more orders</Button></div>}
    </>}
  </section>;
}
