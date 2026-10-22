'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
type Theme='light'|'dark'|'system'; type Density='comfortable'|'compact';
const Context=createContext<{theme:Theme;density:Density;setTheme:(t:Theme)=>void;setDensity:(d:Density)=>void}>({theme:'system',density:'comfortable',setTheme:()=>{},setDensity:()=>{}});
export function DisplayProvider({children}:{children:ReactNode}) {
 const [theme,setTheme]=useState<Theme>('system'); const [density,setDensity]=useState<Density>('comfortable'); const [ready,setReady]=useState(false);
 useEffect(()=>{try{const t=localStorage.getItem('ahp.staff.theme'), d=localStorage.getItem('ahp.staff.density');if(t==='dark'||t==='light'||t==='system')setTheme(t);if(d==='compact'||d==='comfortable')setDensity(d);}catch{}setReady(true);},[]);
 useEffect(()=>{if(!ready)return; const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;document.documentElement.dataset.density=density;};apply();media.addEventListener('change',apply);try{localStorage.setItem('ahp.staff.theme',theme);localStorage.setItem('ahp.staff.density',density);}catch{}return()=>media.removeEventListener('change',apply);},[theme,density,ready]);
 return <Context.Provider value={{theme,density,setTheme,setDensity}}>{children}</Context.Provider>;
}
export function DisplayPreferences() {
 const {theme,density,setTheme,setDensity}=useContext(Context);
 return <div className="ahp-preferences"><label className="ahp-pref-control"><Icon name={theme==='dark'?'moon':theme==='light'?'sun':'monitor'} size={16}/><span className="sr-only">Color theme</span><select aria-label="Color theme" value={theme} onChange={e=>setTheme(e.target.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button type="button" className="ahp-icon-button ahp-density-button" aria-label={density==='compact'?'Use comfortable density':'Use compact density'} aria-pressed={density==='compact'} title={density==='compact'?'Comfortable density':'Compact density'} onClick={()=>setDensity(density==='compact'?'comfortable':'compact')}><Icon name="rows" size={18}/></button></div>;
}
