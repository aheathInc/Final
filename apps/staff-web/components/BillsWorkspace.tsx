'use client';
import { useEffect,useState } from 'react';
import { api,errorMessage } from '@/lib/api';
import { Badge,Button,Card,Empty,Notice } from './ui';
type Bill={id:string;reference:string;title:string;amount:number;currency:string;status:string;expires_at:string;paid_at:string|null};
export function BillsWorkspace(){
 const [rows,setRows]=useState<Bill[]>([]),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const [version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError(null);setRows([]);
   api.get<{data:Bill[]}>('/payments/bills').then(({data})=>{if(!Array.isArray(data.data))throw new Error('Invalid bill response');if(active)setRows(data.data);})
   .catch(e=>{if(active)setError(errorMessage(e,'Bills could not be loaded.'));}).finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[version]);
 return <section className="my-6" aria-label="Issued bills"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Issued bills</h2><Button variant="quiet" disabled={loading} onClick={()=>setVersion(x=>x+1)}>Refresh bills</Button></div>
 {loading?<p role="status">Loading authorized bills…</p>:error?<Notice>{error}</Notice>:rows.length===0?<Empty>No bills have been issued.</Empty>:
 <ul className="grid gap-3 md:grid-cols-2">{rows.map(b=><li key={b.id}><Card><div className="flex justify-between gap-3"><h3 className="font-semibold">{b.title}</h3><Badge tone={b.status==='paid'?'good':'neutral'}>{b.status}</Badge></div><p className="my-3 text-2xl font-semibold tabular-nums">{b.amount.toLocaleString()} {b.currency}</p><p className="break-all font-mono text-xs">{b.reference}</p><p className="mt-2 text-sm text-ink-soft">{b.paid_at?'A settlement record is available below.':'Due until '+new Date(b.expires_at).toLocaleString()}</p></Card></li>)}</ul>}
 <p className="mt-3 text-sm text-ink-soft">Latest 100 authorized bills. Consultations are billed from their assigned clinician’s case page. Check the settlement environment below: test or simulated is not live money.</p></section>;
}
