'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { InvestigationOrder } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Empty } from '../ui';
import { Icon } from './Icon';
export function DiagnosticsTable({orders}:{orders:InvestigationOrder[]}) {
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
 const rows=useMemo(()=>orders.filter(o=>(filter==='all'||(filter==='critical'?o.is_critical:filter==='resulted'?o.status==='resulted':o.status!=='resulted'))&&`${o.investigation_code} ${o.investigation_type} ${o.status}`.toLowerCase().includes(query.toLowerCase())),[orders,filter,query]);
 return <section className="ahp-card p-0"><div className="ahp-tab-bar" aria-label="Diagnostic order filters">{[['all',`Recent orders (${orders.length})`],['pending','Not resulted'],['resulted','Resulted'],['critical','Critical']].map(([value,label])=><button type="button" key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value}>{label}</button>)}</div><div className="ahp-toolbar"><label className="ahp-filter-input"><Icon name="search" size={17}/><span className="sr-only">Filter loaded diagnostic orders</span><input type="search" placeholder="Search loaded orders…" value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="ahp-caption">{rows.length} matching records</span></div>
 {!rows.length?<Empty>{orders.length?'No loaded orders match these filters.':'You do not have diagnostic orders yet.'}</Empty>:<div className="ahp-table-wrap"><table><thead><tr><th scope="col">Investigation</th><th scope="col">Status</th><th scope="col">Ordered</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map(o=><tr key={o.id}><td><div className="ahp-row-person"><span className="ahp-avatar" aria-hidden="true"><Icon name="flask" size={17}/></span><div><span className="ahp-row-title">{o.investigation_code}</span><small className="ahp-row-secondary">{o.investigation_type.replace(/_/g,' ')}</small></div></div></td><td><Badge tone={o.is_critical?'problem':o.status==='resulted'?'good':'neutral'}>{o.is_critical?'Critical · ':''}{o.status.replace(/_/g,' ')}</Badge></td><td>{dateTime(o.ordered_at)}</td><td><Link className="ahp-view-link" href={`/doctor/diagnostics/${o.id}`}>View<span className="sr-only"> {o.investigation_code}</span></Link></td></tr>)}</tbody></table></div>}
 <p className="ahp-table-footnote">The reported status is supplied by the diagnostics service. No result is interpreted here.</p></section>;
}
