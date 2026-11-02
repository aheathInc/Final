'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import type { InsightReport } from './insightTypes';
import { caseCount } from './insightTypes';
import styles from './regionalInsights.module.css';

type Rows = InsightReport['distribution'];
const tileUrl = process.env.NEXT_PUBLIC_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
function MapCanvas({rows,onSelect,busy,error,onRetry}:{rows:Rows;onSelect:(code:string)=>void;busy:boolean;error:string;onRetry:()=>void}) {
  const container=useRef<HTMLDivElement>(null), map=useRef<Leaflet.Map|null>(null), tiles=useRef<Leaflet.TileLayer|null>(null);
  const library=useRef<typeof Leaflet|null>(null), selection=useRef(onSelect), fit=useRef<()=>void>(()=>{});
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[tilesLoading,setTilesLoading]=useState(true);
  selection.current=onSelect;
  useEffect(()=>{container.current?.toggleAttribute('inert',busy||Boolean(error));},[busy,error]);
  useEffect(()=>{
    let disposed=false;
    let resize:ResizeObserver|undefined;
    import('leaflet').then(L=>{
      if(disposed||!container.current)return;
      library.current=L;
      const instance=L.map(container.current,{zoomControl:false,scrollWheelZoom:false,minZoom:2,maxZoom:19,worldCopyJump:true,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});
      map.current=instance;
      instance.attributionControl.setPrefix(false);
      const layer=L.tileLayer(tileUrl,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(instance);
      tiles.current=layer;
      layer.on('tileerror',()=>{if(!disposed)setFailed(true);});
      layer.on('loading',()=>{if(!disposed)setTilesLoading(true);});
      layer.on('load',()=>{if(!disposed)setTilesLoading(false);});
      instance.setView([0,0],2); // World context, never an inferred patient location.
      resize=new ResizeObserver(()=>{if(!disposed){instance.invalidateSize({pan:false});fit.current();}});
      resize.observe(container.current);
      setReady(true);
    }).catch(()=>{if(!disposed)setFailed(true);});
    return()=>{disposed=true;resize?.disconnect();map.current?.remove();map.current=null;tiles.current=null;};
  },[]);
  useEffect(()=>{
    const L=library.current,instance=map.current;
    if(!ready||!L||!instance)return;
    const points=rows.filter(r=>r.cases!==null&&r.latitude!==null&&r.longitude!==null);
    const group=L.layerGroup().addTo(instance);
    for(const point of points){
      const badge=document.createElement('span');badge.className=styles.markerCount;badge.textContent=caseCount(point.cases);
      const name=`${point.name}: ${caseCount(point.cases)} published cases. Filter this area.`;
      const marker=L.marker([point.latitude!,point.longitude!],{keyboard:true,title:name,alt:name,icon:L.divIcon({html:badge,className:styles.areaMarker,iconSize:[48,44],iconAnchor:[24,22]})}).addTo(group);
      const element=marker.getElement();
      element?.setAttribute('aria-label',name);
      element?.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();marker.fire('click');}});
      const label=document.createElement('span');label.textContent=`${point.name}: ${caseCount(point.cases)} cases`;
      marker.bindTooltip(label,{direction:'top'}).on('click',()=>selection.current(point.code));
    }
    fit.current=()=>{
      instance.invalidateSize({pan:false});
      if(points.length)instance.fitBounds(L.latLngBounds(points.map(p=>[p.latitude!,p.longitude!] as [number,number])),{padding:[55,55],maxZoom:10,animate:false});
      else instance.setView([0,0],2,{animate:false});
    };
    fit.current();
    return()=>{group.remove();};
  },[rows,ready]);
  const mapped=rows.filter(r=>r.cases!==null&&r.latitude!==null&&r.longitude!==null).length;
  return <div className={styles.osmStage} aria-busy={busy}>
    <div ref={container} className={styles.osmCanvas} aria-label="OpenStreetMap disease distribution"/>
    <div className={styles.osmControls} aria-label="Map controls">
      <button onClick={()=>map.current?.zoomIn()} disabled={!ready||busy||!!error} aria-label="Zoom in"><Plus size={18}/></button>
      <button onClick={()=>map.current?.zoomOut()} disabled={!ready||busy||!!error} aria-label="Zoom out"><Minus size={18}/></button>
      <button onClick={()=>fit.current()} disabled={!ready||busy||!!error} aria-label="Fit recorded areas"><RotateCcw size={18}/></button>
    </div>
    {(busy||error||!ready||tilesLoading||failed||!mapped)&&<div className={styles.osmNotice} role="status">
      {error?<>{error}<button onClick={onRetry}>Retry insights</button></>:busy?'Updating disease counts...':failed?<>OpenStreetMap could not fully load. Area counts remain available.<button onClick={()=>{setFailed(false);if(tiles.current)tiles.current.redraw();else window.location.reload();}}>Retry map</button></>:!ready||tilesLoading?'Loading OpenStreetMap...':'No publishable areas with recorded map coordinates. Choose an area with recorded coordinates to see its cases.'}
    </div>}
    {(busy||error)&&<div className={styles.mapBusy}/>}
  </div>;
}
export function InsightMap({rows,onSelect,filters,title,source,busy=false,error='',onRetry}:{rows:Rows;onSelect:(code:string)=>void;filters:ReactNode;title:string;source:string;busy?:boolean;error?:string;onRetry:()=>void}) {
  const [expanded,setExpanded]=useState(false),[mounted,setMounted]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null), opener=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setMounted(true);setExpanded(new URL(window.location.href).searchParams.get('map')==='fullscreen');},[]);
  function toggle(value:boolean){
    setExpanded(value);
    const url=new URL(window.location.href);
    if(value)url.searchParams.set('map','fullscreen');else url.searchParams.delete('map');
    window.history.replaceState(window.history.state,'',url);
  }
  useEffect(()=>{
    if(!expanded||!mounted)return;
    const node=dialog.current;if(!node)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';node.showModal();
    return()=>{node.close();document.body.style.overflow=previousOverflow;opener.current?.focus({preventScroll:true});};
  },[expanded,mounted]);
  const missing=rows.filter(r=>r.cases!==null&&(r.latitude===null||r.longitude===null)).length;
  const note=<p className={styles.mapFootnote}>Administrative centres only. {missing>0?`${missing} published areas have no recorded map coordinates. `:''}Patient coordinates are never used. <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a></p>;
  return <div className={styles.mapWrap}>
    <div className={styles.mapLaunch}><p>Drag to pan. Use zoom controls or pinch to explore.</p><button ref={opener} onClick={()=>toggle(true)}><Maximize2 size={18}/>Fullscreen map</button></div>
    {!expanded&&<MapCanvas rows={rows} onSelect={onSelect} busy={busy} error={error} onRetry={onRetry}/>}
    {note}
    {mounted&&expanded&&createPortal(<dialog ref={dialog} className={`${styles.insights} ${styles.fullMap}`} aria-label="Fullscreen disease map" onCancel={e=>{e.preventDefault();toggle(false);}}>
      <header className={styles.fullMapHeader}><div><h2>{title}</h2><p>{source}</p></div><button onClick={()=>toggle(false)} autoFocus><Minimize2 size={18}/>Exit fullscreen</button></header>
      <details className={styles.fullMapFilters}><summary>Disease & location filters</summary>{filters}</details>
      <MapCanvas rows={rows} onSelect={onSelect} busy={busy} error={error} onRetry={onRetry}/>
      {note}
    </dialog>,document.body)}
  </div>;
}
