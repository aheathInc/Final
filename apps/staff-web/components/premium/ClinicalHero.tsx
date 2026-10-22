'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { heroFor, type HeroKind } from '@/lib/premium/navigation';
import { Icon } from './Icon';
import { clinicalArtwork } from '@/lib/premium/artwork';
export function ClinicalHero({title,lede,action,kind,eyebrow}: {title:string;lede?:string;action?:ReactNode;kind?:HeroKind;eyebrow?:string}) {
  const route=heroFor(usePathname()??''); const visual=kind??route.kind;
  return <header className={`ahp-hero ahp-hero--${visual}`}>
    <div className="ahp-hero-copy"><span className="ahp-eyebrow">{eyebrow??route.eyebrow}</span><h1>{title}</h1>{lede&&<p>{lede}</p>}{action&&<div className="ahp-hero-actions">{action}</div>}</div>
    <div className="ahp-hero-visual" aria-hidden="true"><span className="ahp-hero-orb"/>
      {/* Decorative assets are local; never a patient image or clinical result. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clinicalArtwork[visual].src} width="440" height="220" alt="" decoding="async"/>
      <div className="ahp-hero-note"><span><Icon name={visual==='analytics'?'chart':visual==='followup'?'heart':'shield'} size={24}/></span><div><strong>{route.note}</strong><small>{route.caption}</small></div></div>
    </div>
  </header>;
}
