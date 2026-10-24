'use client';
import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, Notice, inputClass } from './ui';
export function BillIssuer({ consultationId }: { consultationId: string }) {
  const [title,setTitle]=useState('Consultation');
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [reference,setReference]=useState<string|null>(null);
  const request=useRef<{body:string;key:string}|null>(null);
  async function submit(event:React.FormEvent) {
    event.preventDefault(); if(busy) return;
    const value=Number(amount);
    if(!Number.isSafeInteger(value)||value<1||value>2147483647){setError('Enter an approved, whole TZS amount.');return;}
    const payload={consultation_id:consultationId,title:title.trim(),amount:value,currency:'TZS'};
    const body=JSON.stringify(payload);
    if(request.current?.body!==body)request.current={body,key:crypto.randomUUID()};
    setBusy(true);setError(null);
    try { const {data}=await api.post<{reference:string}>('/payments/bills',payload,{headers:{'Idempotency-Key':request.current.key}});
      setReference(data.reference);
    } catch(e){setError(errorMessage(e,'The bill was not confirmed. Retry with the same details.'));}
    finally {setBusy(false);}
  }
  return <Card><h2 className="text-xl font-semibold">Issue a consultation bill</h2>
    <p className="mt-2 text-sm text-ink-soft">Use the facility-approved fee. Issuing a bill does not mark it paid or change clinical clearance. Do not put diagnoses in its title.</p>
    {error&&<Notice>{error}</Notice>}
    {reference?<p role="status" className="mt-4">Bill issued: <strong>{reference}</strong>. The authorized payer can open Bills in the Patient App.</p>:
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Service title" htmlFor="bill-title"><input className={inputClass} id="bill-title" required minLength={3} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></Field>
        <Field label="Approved amount (TZS)" htmlFor="bill-amount"><input className={inputClass} id="bill-amount" type="number" min="1" max="2147483647" step="1" required value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy}/></Field>
        <Button type="submit" disabled={busy}>{busy?'Issuing bill…':'Issue bill'}</Button>
      </form>}
  </Card>;
}
