'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Badge, Button, Empty, Field, Notice, inputClass } from './ui';

type Member = { id: string; isActive: boolean; user: { email: string | null; fullName: string | null } };
export function LaboratoryMembers({ facilityId }: { facilityId: string }) {
  const [members, setMembers] = useState<Member[]>([]), [email, setEmail] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  async function load() {
    const { data } = await api.get<{ data: Member[] }>('/laboratory/memberships', { params: { facility_id: facilityId } });
    setMembers(data.data);
  }
  useEffect(() => { void load().catch(e => setError(errorMessage(e, 'Could not load laboratory staff.'))).finally(() => setBusy(false)); }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function assign(address: string, active: boolean) {
    setBusy(true); setError(null); setSaved(null);
    try {
      await api.post('/laboratory/memberships', { facility_id: facilityId, email: address.trim().toLowerCase(), is_active: active });
      await load(); setEmail(''); setSaved(active ? 'Laboratory access granted.' : 'Laboratory access revoked.');
    } catch (e) { setError(errorMessage(e, 'Could not update laboratory access.')); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 space-y-4" aria-label="Laboratory staff access">
    <h2 className="text-lg font-semibold">Laboratory staff access</h2>
    <p className="max-w-prose text-sm text-ink-soft">Assign an active lab technician account to this facility. Access covers laboratory, pathology and point-of-care orders directed here.</p>
    {error && <Notice>{error}</Notice>}{saved && <p role="status">{saved}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void assign(email, true); }}>
      <Field label="Lab technician email" htmlFor="lab-member-email"><input id="lab-member-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} /></Field>
      <Button type="submit" disabled={busy}>Grant laboratory access</Button>
    </form>
    {!busy && !error && !members.length && <Empty>No laboratory staff are assigned to this facility.</Empty>}
    <ul className="space-y-3">{members.map(member => <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
      <div className="min-w-0"><p className="break-words font-medium">{member.user.fullName ?? member.user.email}</p><p className="break-all text-sm text-ink-soft">{member.user.email}</p></div>
      <Badge>{member.isActive ? 'Active' : 'Revoked'}</Badge><Button variant="quiet" disabled={busy || !member.user.email} onClick={() => void assign(member.user.email!, !member.isActive)}>{member.isActive ? 'Revoke access' : 'Restore access'}</Button>
    </li>)}</ul>
  </section>;
}
