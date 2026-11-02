'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api, errorMessage } from '@/lib/api';
import { InsightMap } from './InsightMap';
import { DiseaseTrends } from './DiseaseTrends';
import { levels, caseCount, type Level, type InsightReport } from './insightTypes';
import styles from './regionalInsights.module.css';
const title=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
function Field({label,children}:{label:string;children:ReactNode}) {return <label className={styles.field}><span>{label}</span>{children}</label>;}
const colors=['var(--ahp-brand)','var(--ahp-blue)','var(--ahp-danger)'];
export function RegionalInsights() {
  const [data,setData]=useState<InsightReport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[condition,setCondition]=useState(''),[level,setLevel]=useState<Level>('region');
  const [geo,setGeo]=useState<string[]>(['','','','','']),[compare,setCompare]=useState<string[]>([]),[refresh,setRefresh]=useState(0);
  const [month,setMonth]=useState(()=>{const d=new Date();d.setUTCMonth(d.getUTCMonth()-1,1);return d.toISOString().slice(0,7);});
  const [busy,setBusy]=useState(false),[actionMessage,setActionMessage]=useState(''),[confirmed,setConfirmed]=useState(false);
  const file=useRef<HTMLInputElement>(null);
  const area=[...geo].reverse().find(Boolean)??'';
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setData(null);
    const query=new URLSearchParams({level});for(const [k,v] of Object.entries({from,to,condition,area}))if(v)query.set(k,v);
    api.get<InsightReport>('/surveillance/regional-insights?'+query,{signal:controller.signal}).then(r=>{setData(r.data);setCompare(c=>c.filter(code=>r.data.distribution.some(a=>a.code===code)));})
      .catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e,'Insights could not load. Check your connection and retry.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[from,to,condition,area,level,refresh]);
  // Keep metadata during loading so dependent selectors never flash to incorrect options.
  const metadata=useRef<Pick<InsightReport,'areas'|'conditions'|'conditionLabels'|'availablePeriods'>>({areas:[],conditions:[],conditionLabels:{},availablePeriods:[]});
  if(data)metadata.current=data;
  const options=metadata.current;
  const mapData=useRef<InsightReport|null>(null);
  if(data)mapData.current=data;
  const areaName=options.areas.find(a=>a.code===area)?.name??'all recorded areas';
  const selectedDisease=condition?(options.conditionLabels?.[condition]??condition):'All diseases';
  function selectArea(code:string) {
    const next=['','','','',''];let a=options.areas.find(a=>a.code===code);
    while(a){next[levels.indexOf(a.level)]=a.code;a=options.areas.find(p=>p.code===a!.parentCode);}
    setGeo(next);const i=next.reduce((last,value,index)=>value?index:last,-1);setLevel(levels[Math.min(4,i+1)]);setCompare([]);
  }
  const chart=useMemo(()=>data?.trend.map(t=>({period:t.period,total:t.cases,...Object.fromEntries(t.areas.map(a=>[a.code,a.cases]))}))??[],[data]);
  async function publish() {
    setBusy(true);setActionMessage('');
    try {await api.post('/surveillance/regional-insights/releases',{period:month});setActionMessage('Monthly report published. Its protected cells are now fixed.');setFrom('');setTo('');setGeo(['','','','','']);setCondition('');setRefresh(n=>n+1);setConfirmed(false);}
    catch(e){setActionMessage(errorMessage(e,'The report could not be published. Try again.'));}finally{setBusy(false);}
  }
  async function importCatalogue() {
    const selected=file.current?.files?.[0];if(!selected)return;
    setBusy(true);setActionMessage('');
    try {if(selected.size>1000000)throw Error('Choose a JSON file smaller than 1 MB.');const body=JSON.parse(await selected.text());const r=await api.post('/surveillance/reporting-areas',body);setActionMessage(`${r.data.added} administrative areas imported. They will be used in future monthly publications.`);}
    catch(e){setActionMessage(errorMessage(e,e instanceof Error?e.message:'Import failed. Check the file format.'));}finally{setBusy(false);}
  }
  const reset=()=>{setGeo(['','','','','']);setFrom('');setTo('');setCondition('');setLevel('region');setCompare([]);};
  const filters=(
    <form className={styles.filters} onSubmit={e=>e.preventDefault()} aria-label="Insight filters">
      <div className={styles.filterHeading}><strong><SlidersHorizontal size={18}/> Explore an area</strong><button type="button" onClick={reset}>Reset filters</button></div>
      <div className={styles.geography}>{levels.map((l,i)=>{
        const parent=geo[i-1];const choices=options.areas.filter(a=>a.level===l&&(!i||parent?a.parentCode===(parent||null):i===1));
        const prerequisite=i>1&&!parent&&options.areas.some(a=>a.level===l)?`Select ${levels[i-1]} first`:'';
        return <Field key={l} label={title(l)}><select aria-label={title(l)} value={geo[i]} disabled={!choices.length} onChange={e=>{const value=e.target.value;setGeo(g=>g.map((v,j)=>j<i?v:j===i?value:''));setLevel(levels[Math.min(4,value?i+1:Math.max(1,i))]);setCompare([]);}}>
          <option value="">{choices.length?`All ${l==='country'?'countries':l==='district'?'districts':l+'s'}`:prerequisite||'Not recorded'}</option>{choices.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}
        </select></Field>;
      })}</div>
      <div className={styles.secondaryFilters}>
        <Field label="From month"><select aria-label="From month" value={from} onChange={e=>setFrom(e.target.value)}><option value="">Earliest in view</option>{options.availablePeriods.map(p=><option key={p}>{p}</option>)}</select></Field>
        <Field label="To month"><select aria-label="To month" value={to} onChange={e=>setTo(e.target.value)}><option value="">Latest published</option>{options.availablePeriods.map(p=><option key={p}>{p}</option>)}</select></Field>
        <Field label="Disease"><select aria-label="Disease" value={condition} onChange={e=>setCondition(e.target.value)}><option value="">All diseases</option>{options.conditions.map(c=><option key={c} value={c}>{options.conditionLabels?.[c]&&options.conditionLabels[c]!==c?`${options.conditionLabels[c]} (${c})`:c}</option>)}</select></Field>
        <Field label="Compare by"><select aria-label="Compare by" value={level} onChange={e=>{setLevel(e.target.value as Level);setCompare([]);}}>{levels.map(l=><option key={l} value={l}>{title(l)}</option>)}</select></Field>
      </div>
    </form>
  );
  return <section className={styles.insights} aria-label="Health & Regional Insights">
    <div className={styles.intro}><div><h2>Disease insights by location</h2><p>Choose a region or district to explore leading diseases, monthly changes and where cases are reported.</p></div><span className={styles.protected}><ShieldCheck size={18}/>Protected aggregates</span></div>
    {filters}
    {loading&&<p className={styles.state} role="status">Loading authorized aggregates…</p>}
    {error&&<div className={styles.state} role="alert"><p>{error}</p><button onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/>Retry</button></div>}
    {data&&<>
      <div className={styles.summary} aria-live="polite"><p><strong>{caseCount(data.totalCases)}</strong> published diagnosis cases <span>across {data.releases.length} published months</span></p><p>Source: {data.source}<br/>Cases count signed consultations per diagnosis, not unique people or disease prevalence.</p></div>
      {!data.releases.length?<div className={styles.state}><h3>No monthly reports published yet</h3><p>Publish an authorized completed month below to see leading diseases and disease trends by region or district. Unknown geographic levels remain blank.</p></div>:<>
      <DiseaseTrends data={data} areaName={areaName} selected={condition} onSelect={setCondition} onClear={()=>setCondition('')}/>

      <section className={styles.panel}><header className={styles.trendHeading}><div><h3>{selectedDisease}: compare {level==='country'?'countries':level+'s'}</h3><p>{compare.length?'Comparing selected areas.':'Select up to three areas to compare monthly case counts. Select a disease above to focus this comparison.'} Gaps are unavailable, never zero.</p></div><span className={styles.caption}>Completed calendar months · UTC</span></header>
        <div className={styles.legend}>{compare.length?compare.map((code,i)=><span key={code}><i style={{background:colors[i]}}/>{data.areas.find(a=>a.code===code)?.name}</span>):<span><i style={{background:colors[0]}}/>Published cases</span>}</div>
        <div className={styles.chart} role="img" aria-label="Monthly published diagnosis cases; exact values are in the table below"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:10,right:20,left:0,bottom:10}}><CartesianGrid vertical={false} stroke="var(--ahp-line)"/><XAxis dataKey="period" tick={{fill:'var(--ahp-muted)',fontSize:12}} minTickGap={25}/><YAxis allowDecimals={false} tick={{fill:'var(--ahp-muted)',fontSize:12}} width={45}/><Tooltip contentStyle={{background:'var(--ahp-surface)',color:'var(--ahp-ink)',border:'1px solid var(--ahp-line)'}}/>{(compare.length?compare:['total']).map((key,i)=><Line key={key} dataKey={key} name={key==='total'?'Published cases':data.areas.find(a=>a.code===key)?.name} stroke={colors[i]} strokeWidth={2.5} dot={{r:4}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>
        <div className={styles.tableScroll}><table><caption>Compare {level} case counts</caption><thead><tr><th scope="col">Compare</th><th scope="col">{title(level)}</th><th scope="col">Published cases</th>{!condition&&<th scope="col">Leading disease ({data.diseaseComparison.latestPeriod??'latest month'})</th>}<th scope="col">Explore</th></tr></thead><tbody>{data.distribution.map(a=><tr key={a.code}><td><input type="checkbox" aria-label={`Compare ${a.name}`} checked={compare.includes(a.code)} disabled={a.cases===null||(!compare.includes(a.code)&&compare.length===3)} onChange={()=>setCompare(c=>c.includes(a.code)?c.filter(x=>x!==a.code):[...c,a.code])}/></td><th scope="row">{a.name}</th><td>{caseCount(a.cases)}</td>{!condition&&<td>{a.leadingDisease?<>{a.leadingDisease.name}<span className={styles.diseaseCode}>{caseCount(a.leadingDisease.cases)} cases</span></>:'Unavailable'}</td>}<td><button onClick={()=>selectArea(a.code)}>View area</button></td></tr>)}</tbody></table>{!data.distribution.length&&<p className={styles.empty}>No recorded {level} geography for this view. Choose a recorded level or reset filters.</p>}</div>
        <details className={styles.dataDetails}><summary>Monthly values (accessible table)</summary><div className={styles.tableScroll}><table><thead><tr><th>Month</th><th>Published cases</th>{compare.map(code=><th key={code}>{data.areas.find(a=>a.code===code)?.name}</th>)}</tr></thead><tbody>{data.trend.map(t=><tr key={t.period}><th scope="row">{t.period}</th><td>{caseCount(t.cases)}</td>{compare.map(code=><td key={code}>{caseCount(t.areas.find(a=>a.code===code)?.cases??null)}</td>)}</tr>)}</tbody></table></div></details>
      </section>
      </>}
      <aside className={styles.privacy}><ShieldCheck size={22}/><div><strong>Privacy & interpretation</strong><p>{data.privacy.rule} Published cases without a recorded {level}: {caseCount(data.unlocatedCases)}. Missing country, district, ward, village or map coordinates are never inferred. Names, patient IDs, notes and household locations are excluded.</p></div></aside>
    </>}
    {mapData.current&&<section className={styles.panel}><header><h3>{selectedDisease}: geographic distribution</h3><p>Published cases in {areaName}. Select a mapped area to explore its diseases at the next geographic level.</p></header><InsightMap rows={mapData.current.distribution} onSelect={selectArea} filters={filters} title={`${selectedDisease} in ${areaName}`} source={mapData.current.source} busy={loading} error={error} onRetry={()=>setRefresh(n=>n+1)}/></section>}
    <details className={styles.manage}><summary>Manage authorized monthly reports</summary><div className={styles.manageBody}><h3>Publish a completed month</h3><p>Use signed A-Health diagnoses already authorized for this administrative purpose. A publication is fixed: later edits or geography imports do not rewrite it. Review geography before publishing.</p><Field label="Completed month"><input type="month" value={month} max={new Date(new Date().getFullYear(),new Date().getMonth()-1,15).toISOString().slice(0,7)} onChange={e=>setMonth(e.target.value)}/></Field><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm authorization to publish this month’s protected aggregates.</label><button className={styles.primary} disabled={busy||!confirmed||!month} onClick={()=>void publish()}>{busy?'Working…':'Publish monthly report'}</button>
      <details className={styles.dataDetails}><summary>Import an administrative geography catalogue</summary><p>Optional: upload an authorized JSON catalogue with source, administrative_centroids_confirmed and areas. Up to 1,000 areas per batch. Existing records continue to work without invented hierarchy.</p><input ref={file} type="file" accept="application/json,.json" aria-label="Geography catalogue JSON"/><button disabled={busy} onClick={()=>void importCatalogue()}>Import catalogue</button></details>
      {actionMessage&&<p role="status">{actionMessage}</p>}
    </div></details>
  </section>;
}
