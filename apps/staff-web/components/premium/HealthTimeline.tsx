'use client';
import { useState } from 'react';
import { Badge, Empty, Notice } from '../ui';
import { Icon } from './Icon';
export interface HealthTimelineEntry {
 id:string;category:string;occurred_at:string;status:string;verification_state:string;summary:string;
 source:{type:'ahp'|'external';name:string;facility_name:string|null;record_id:string};detail:Record<string,unknown>;
 provenance?:{source_version:string|null;imported_at:string;transformation_version:string;payload_hash:string};
}
const iconFor=(category:string)=>category.includes('diagnostic')||category==='Observation'?'flask':category.includes('prescription')||category.includes('dispens')||category==='MedicationRequest'?'pill':category.includes('referral')?'send':'file';
export function HealthTimeline({entries,unavailable}:{entries:HealthTimelineEntry[];unavailable:boolean}) {
 const [filter,setFilter]=useState('all'); const visible=entries.filter(e=>filter==='all'||e.source.type===filter);
 return <section className="ahp-card ahp-history-timeline"><div className="ahp-section-heading"><h2>Care timeline</h2><span className="ahp-caption">{unavailable?'Not available':`${entries.length} loaded entries`}</span></div>
 <div className="ahp-tab-bar ahp-tabs-in-card" aria-label="Timeline source filters">{[['all','All records'],['ahp','AHP records'],['external','Imported']].map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
 {unavailable?<Notice>This history is unavailable or the required authorization has not been granted. No empty-history claim is made.</Notice>:!visible.length?<Empty>No authorized records match this view.</Empty>:<ol className="ahp-timeline">{visible.map(entry=><li key={`${entry.source.type}-${entry.id}`}><span className="ahp-timeline-icon"><Icon name={iconFor(entry.category)} size={16}/></span><div className="ahp-row"><h3>{entry.summary}</h3><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString()}</time></div><p>{entry.category.replace(/_/g,' ')} · {entry.source.name}{entry.source.facility_name?` / ${entry.source.facility_name}`:''}</p><Badge tone={entry.source.type==='external'?'attention':'neutral'}>{entry.source.type==='external'?'Imported record':entry.status.replace(/_/g,' ')}</Badge>
 <details><summary>Record details & source</summary><p>Status: {entry.status.replace(/_/g,' ')} · Verification: {entry.verification_state.replace(/_/g,' ')}</p><p className="ahp-timeline-code">Source record: {entry.source.record_id}</p>{Object.keys(entry.detail).length>0&&<dl>{Object.entries(entry.detail).map(([key,value])=><div key={key}><dt className="font-medium">{key.replace(/_/g,' ')}</dt><dd>{typeof value==='string'?value:JSON.stringify(value)}</dd></div>)}</dl>}{entry.provenance&&<p className="ahp-timeline-code">Provenance: v{entry.provenance.source_version??'unknown'} · {entry.provenance.transformation_version} · imported {new Date(entry.provenance.imported_at).toLocaleString()} · {entry.provenance.payload_hash}</p>}</details></li>)}</ol>}
 <p className="ahp-caption">External records retain their source and are not independently verified AHP diagnoses.</p></section>;
}
