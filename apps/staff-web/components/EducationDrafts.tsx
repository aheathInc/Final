'use client';
import {useEffect,useState} from 'react';
import {api,errorMessage} from '@/lib/api';
import {Button,Notice} from './ui';
import styles from './patient-platform.module.css';
type Draft={slug:string;title:string;summary:string;body:string|null;language:string;disease_guide:Record<string,string>;sources:{title:string;url:string}[]};
export function EducationDrafts(){
 const [rows,setRows]=useState<Draft[]>([]),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 async function load(){try{setRows((await api.get('/education/drafts')).data.data);setError(null);}catch(e){setError(errorMessage(e,'Rasimu hazikupatikana. Jaribu tena.'));}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function publish(d:Draft){setBusy(true);try{await api.post(`/education/articles/${encodeURIComponent(d.slug)}/publish`,{},{params:{language:d.language}});await load();}catch(e){setError(errorMessage(e,'Rasimu haikuchapishwa.'));}finally{setBusy(false);}}
 const labels:Record<string,string>={causes:'Sababu',symptoms:'Dalili',prevention:'Kinga',diagnosis:'Uchunguzi',treatment:'Chaguo za matibabu',warning_signs:'Dalili za hatari'};
 return <section className={styles.create}><div className={styles.toolbar}><h2>Rasimu zinazohitaji mapitio</h2><Button variant="quiet" disabled={busy} onClick={()=>void load()}>Sasisha rasimu</Button></div>{error&&<Notice>{error}</Notice>}{loading?<p>Inapakia rasimu…</p>:!rows.length?<p>Hakuna rasimu inayosubiri mapitio.</p>:rows.map(d=><details key={`${d.slug}-${d.language}`} className={styles.review}><summary>{d.title} · {d.language.toUpperCase()}</summary><p className={styles.body}>{d.summary}</p>{d.body&&<p className={styles.body}>{d.body}</p>}{Object.entries(d.disease_guide??{}).map(([key,text])=><section key={key}><h3>{labels[key]??key}</h3><p className={styles.body}>{text}</p></section>)}{d.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}<p>Chapisha baada ya kuthibitisha usahihi wa kitabibu, lugha rahisi na vyanzo. Uthibitisho utarekodiwa kwa akaunti yako.</p><Button disabled={busy} onClick={()=>void publish(d)}>Nimepitia — chapisha</Button></details>)}</section>;
}
