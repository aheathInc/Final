import { Empty } from '../ui';
export function MetricBars({rows,caption}:{rows:{label:string;value:number|null}[];caption:string}) {
 const max=Math.max(1,...rows.map(row=>row.value??0));
 return <><div className="ahp-metric-bars">{rows.length?rows.map((row,i)=><div className="ahp-metric-bar" key={`${row.label}-${i}`}><div><span>{row.label}</span><strong>{row.value===null?'Unavailable':row.value.toLocaleString()}</strong></div>{row.value!==null&&<div className="ahp-bar-track" aria-hidden="true"><span style={{width:`${Math.max(0,row.value)/max*100}%`}}/></div>}</div>):<Empty>No records returned.</Empty>}</div><p className="ahp-caption">{caption}</p></>;
}
