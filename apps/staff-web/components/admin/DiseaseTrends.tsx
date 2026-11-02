'use client';
import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { caseCount, type InsightReport, type DiseaseInsight } from './insightTypes';
import styles from './regionalInsights.module.css';

const colors = ['var(--ahp-brand)', 'var(--ahp-blue)', 'var(--ahp-danger)'];
const diseaseName = (d:DiseaseInsight) => d.name || d.code;
function movement(d:DiseaseInsight) {
  if(d.changeCases===null || d.changePercent===null) return 'Not enough published data';
  if(d.changeCases===0) return 'No change';
  return `${d.direction==='rising'?'Rising':'Falling'} · ${d.changeCases>0?'+':''}${d.changeCases.toLocaleString('en-TZ')} (${d.changePercent>0?'+':''}${d.changePercent}%)`;
}

export function DiseaseTrends({data,areaName,onSelect,onClear,selected}:{data:InsightReport;areaName:string;onSelect:(code:string)=>void;onClear:()=>void;selected:string}) {
  const [rank,setRank]=useState('cases');
  const ranked=useMemo(()=>[...data.diseases].sort((a,b)=>rank==='rising'
    ? (b.changePercent??-Infinity)-(a.changePercent??-Infinity)||(b.latestCases??-1)-(a.latestCases??-1)||a.code.localeCompare(b.code)
    : (b.latestCases??-1)-(a.latestCases??-1)||(b.cases??0)-(a.cases??0)||a.code.localeCompare(b.code)),[data.diseases,rank]);
  const shown=ranked.slice(0,3);
  const chart=data.trend.map(t=>({period:t.period,...Object.fromEntries(shown.map((d,i)=>['d'+i,d.series.find(p=>p.period===t.period)?.cases??null]))}));
  const {latestPeriod,previousPeriod}=data.diseaseComparison;
  return <section className={styles.panel} aria-label="Disease trends">
    <header className={styles.trendHeading}>
      <div><h3>Trending diseases in {areaName}</h3><p>See which diseases have the most reported cases and which are increasing.</p></div>
      <label className={styles.field}>Rank diseases by<select aria-label="Rank diseases by" value={rank} onChange={e=>setRank(e.target.value)}><option value="cases">Most cases in latest month</option><option value="rising">Largest monthly increase (%)</option></select></label>
    </header>
    <p className={styles.caption}>Latest month: {latestPeriod??'Unavailable'} · Compared with: {previousPeriod??'Unavailable'}. Changes use published counts in consecutive calendar months; they are not outbreak alerts.</p>
    {selected&&<button className={styles.diseaseReset} onClick={onClear}>Show all diseases in this area</button>}
    {!ranked.length?<p className={styles.empty}>No publishable disease counts for this area and period.</p>:<>
      <div className={styles.legend}>{shown.map((d,i)=><span key={d.code}><i style={{background:colors[i]}}/>{diseaseName(d)}</span>)}</div>
      <p className={styles.caption}>{selected?'Monthly cases for the selected disease.':'Monthly trends for the first three diseases in the ranking.'} Unavailable months remain gaps.</p>
      <div className={styles.chart} role="img" aria-label={`Disease case trends in ${areaName}; monthly values are available below`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:10,right:20,left:0,bottom:10}}><CartesianGrid vertical={false} stroke="var(--ahp-line)"/><XAxis dataKey="period" tick={{fill:'var(--ahp-muted)',fontSize:12}} minTickGap={25}/><YAxis allowDecimals={false} width={45} tick={{fill:'var(--ahp-muted)',fontSize:12}}/><Tooltip contentStyle={{background:'var(--ahp-surface)',color:'var(--ahp-ink)',border:'1px solid var(--ahp-line)'}}/>{shown.map((d,i)=><Line key={d.code} dataKey={'d'+i} name={diseaseName(d)} stroke={colors[i]} strokeWidth={2.5} dot={{r:4}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>
      <p className={styles.scrollHint}>Scroll the table sideways to see monthly changes and period totals.</p>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Disease ranking table"><table className={styles.diseaseTable}><caption>Disease ranking for {areaName}. Select a disease to see its distribution across areas.</caption><thead><tr><th scope="col">Disease</th><th scope="col">{latestPeriod??'Latest month'}</th><th scope="col">{previousPeriod??'Previous month'}</th><th scope="col">Monthly change</th><th scope="col">Selected period</th></tr></thead><tbody>{ranked.map(d=><tr key={d.code}><th scope="row"><button onClick={()=>onSelect(d.code)} aria-label={`Explore disease ${diseaseName(d)}`} className={styles.diseaseLink}>{diseaseName(d)}</button>{d.name!==d.code&&<small className={styles.diseaseCode}>{d.code}</small>}</th><td>{caseCount(d.latestCases)}</td><td>{caseCount(d.previousCases)}</td><td>{movement(d)}</td><td>{caseCount(d.cases)}</td></tr>)}</tbody></table></div>
      <details className={styles.dataDetails}><summary>Disease monthly values</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Disease monthly values"><table><thead><tr><th scope="col">Month</th>{shown.map(d=><th scope="col" key={d.code}>{diseaseName(d)}</th>)}</tr></thead><tbody>{data.trend.map(t=><tr key={t.period}><th scope="row">{t.period}</th>{shown.map(d=><td key={d.code}>{caseCount(d.series.find(p=>p.period===t.period)?.cases??null)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
