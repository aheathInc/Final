'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { activeHref, navigationFor, roleLabel, type NavigationGroup } from '@/lib/premium/navigation';
import { DisplayPreferences } from './DisplayPreferences';
import { Icon } from './Icon';

// Native modal semantics provide background inertness; wrap boundary tab stops
// explicitly so keyboard focus does not move to browser chrome in Chromium.
function modalKeys(event: ReactKeyboardEvent<HTMLDialogElement>, close: () => void) {
 if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
 if (event.key !== 'Tab') return;
 const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]')).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
 const first = focusable[0], last = focusable[focusable.length - 1];
 if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); return; }
 if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
 else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function Brand() { return <Link href="/" className="ahp-brand" aria-label="A-Health home"><span className="ahp-brand-mark"><Icon name="heart" size={22}/></span><span className="ahp-brand-name">A-Health</span></Link>; }
function Navigation({groups,path,collapsed,onNavigate}:{groups:NavigationGroup[];path:string;collapsed:boolean;onNavigate?:()=>void}) {
 return <nav aria-label="Staff navigation" className="ahp-nav">{groups.map((group,i)=>
  <details className="ahp-nav-group" key={group.label} open={i===0||group.items.some(x=>activeHref(path,x.href))||collapsed}>
   <summary aria-label={group.label} title={collapsed?group.label:undefined}><span>{group.label}</span><Icon name="down" size={12}/></summary>
   <div>{group.items.map(x=><Link key={x.href} href={x.href} onClick={onNavigate} aria-current={activeHref(path,x.href)?'page':undefined} title={collapsed?x.label:undefined} className="ahp-nav-link"><Icon name={x.icon} size={19}/><span className={collapsed?'sr-only':''}>{x.label}</span></Link>)}</div>
  </details>)}</nav>;
}
export function StaffShell({children}:{children:ReactNode}) {
 const pathname=usePathname()??''; const {data:session}=useSession();
 const [collapsed,setCollapsed]=useState(false);const [query,setQuery]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [hydrated,setHydrated]=useState(false);
 const drawer=useRef<HTMLDialogElement>(null), search=useRef<HTMLDialogElement>(null),menuTrigger=useRef<HTMLButtonElement>(null),searchTrigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null), searchInput=useRef<HTMLInputElement>(null), previousPath=useRef(pathname);
 const role=session?.user?.role;const groups=navigationFor(role);const entries=groups.flatMap(x=>x.items);const shown=entries.filter(x=>x.label.toLowerCase().includes(query.toLowerCase()));
 useEffect(()=>{setHydrated(true);try{setCollapsed(localStorage.getItem('ahp.staff.sidebar')==='compact');}catch{}},[]);
 useLayoutEffect(()=>{if(previousPath.current===pathname)return;previousPath.current=pathname;drawer.current?.close();search.current?.close();setQuery('');setError(null);},[pathname]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&pathname!=='/login'){e.preventDefault();search.current?.showModal();searchInput.current?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[pathname]);
 async function logout(){if(busy)return;setBusy(true);setError(null);try{const r=await fetch('/api/logout',{method:'POST'});if(!r.ok)throw new Error();await signOut({redirect:false,callbackUrl:'/login'});window.location.assign('/login');}catch{setError('Sign out could not reach the authentication service. Try again.');setBusy(false);}}
 const closeDrawer=()=>{drawer.current?.close();menuTrigger.current?.focus();};
 const closeSearch=()=>{search.current?.close();searchTrigger.current?.focus();};
 const footer=<div className="ahp-sidebar-footer"><span><Icon name="lock" size={14}/><span className={collapsed?'sr-only':''}>Authorized staff access</span></span><button type="button" disabled={busy} onClick={()=>void logout()} title="Sign out"><Icon name="logout" size={18}/><span className={collapsed?'sr-only':''}>{busy?'Signing out…':'Sign out'}</span></button>{error&&<p role="alert">{error}</p>}</div>;
 if(pathname==='/login')return <main id="main-content" className="ahp-login-root">{children}</main>;
 return <div className={`ahp-shell${collapsed?' ahp-shell--compact':''}`}>
  <a className="ahp-skip-link" href="#main-content">Skip to content</a>
  <aside className="ahp-sidebar"><div className="ahp-sidebar-brand"><Brand/><button className="ahp-collapse" type="button" aria-label={collapsed?'Expand navigation':'Collapse navigation'} onClick={()=>{const next=!collapsed;setCollapsed(next);try{localStorage.setItem('ahp.staff.sidebar',next?'compact':'expanded');}catch{}}}><Icon name={collapsed?'chevron':'left'} size={16}/></button></div>
   <p className="ahp-role-label">{roleLabel(role)}</p><Navigation groups={groups} path={pathname} collapsed={collapsed}/>{footer}</aside>
  <div className="ahp-main-column"><header className="ahp-topbar">
   <button type="button" ref={menuTrigger} disabled={!hydrated} className="ahp-icon-button ahp-mobile-trigger" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="ahp-mobile-navigation" onClick={()=>{drawer.current?.showModal();closeButton.current?.focus();}}><Icon name="menu"/></button>
   <button type="button" ref={searchTrigger} disabled={!hydrated} className="ahp-search-trigger" aria-haspopup="dialog" onClick={()=>{setQuery('');search.current?.showModal();searchInput.current?.focus();}}><Icon name="search" size={18}/><span>Search workspaces…</span><kbd>Ctrl K</kbd></button>
   <div className="ahp-topbar-right"><DisplayPreferences/><span className="ahp-user-role">{roleLabel(role)}</span><div className="ahp-user" title={session?.user?.email??roleLabel(role)}><span className="ahp-user-avatar" aria-hidden="true">{(session?.user?.name??session?.user?.email??'A').trim().slice(0,2).toUpperCase()}</span><span className="ahp-user-name">{session?.user?.name??'Your workspace'}</span></div></div>
  </header><main tabIndex={-1} id="main-content" className="ahp-main">{children}</main><footer className="ahp-page-footer"><span>A-Health <span aria-hidden="true">·</span> Connected care</span><span>People. Care. Connect.</span></footer></div>
  <dialog ref={drawer} id="ahp-mobile-navigation" className="ahp-mobile-drawer" aria-label="Staff navigation" onCancel={event=>{event.preventDefault();closeDrawer();}} onKeyDown={event=>modalKeys(event,closeDrawer)} onClose={()=>menuTrigger.current?.focus()} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDrawer();}}}>
   <div className="ahp-sidebar-brand"><Brand/><button ref={closeButton} type="button" className="ahp-icon-button" onClick={closeDrawer} aria-label="Close navigation"><Icon name="close"/></button></div><p className="ahp-role-label">{roleLabel(role)}</p><Navigation groups={groups} path={pathname} collapsed={false} onNavigate={closeDrawer}/><button className="ahp-mobile-logout" type="button" disabled={busy} onClick={()=>void logout()}><Icon name="logout" size={18}/>Sign out</button>{error&&<p role="alert">{error}</p>}
  </dialog>
  <dialog ref={search} className="ahp-search-dialog" aria-labelledby="ahp-search-title" onCancel={event=>{event.preventDefault();closeSearch();}} onKeyDown={event=>modalKeys(event,closeSearch)} onClose={()=>searchTrigger.current?.focus()}><div className="ahp-search-heading"><div><h2 id="ahp-search-title">Find your workspace</h2><p>Navigation only. Patient records are not searched.</p></div><button type="button" className="ahp-icon-button" aria-label="Close search" onClick={closeSearch}><Icon name="close"/></button></div><input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search available workspaces" placeholder="For example, follow-up or referrals" autoComplete="off"/><div className="ahp-search-results">{shown.length?shown.map(x=><Link key={x.href} href={x.href} onClick={closeSearch}><Icon name={x.icon}/><span>{x.label}</span><Icon name="chevron" size={16}/></Link>):<p>No matching workspace for your role.</p>}</div></dialog>
 </div>;
}
