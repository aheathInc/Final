import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * min-height 2.75rem throughout is not a style preference: it is roughly the
 * smallest target a thumb hits reliably, and a good deal of this console is
 * used on a phone between patients.
 */
export function Button({
  children, variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  const base = 'min-h-11 rounded-xl px-5 py-2.5 font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const kind =
    variant === 'primary' ? 'bg-petrol text-white hover:bg-petrol-lift'
    : variant === 'danger' ? 'bg-clay text-white hover:opacity-90'
    : 'text-petrol hover:bg-[#e2eee7] hover:text-petrol-lift';
  return <button className={`${base} ${kind} ${className}`} {...props}>{children}</button>;
}

/**
 * The only component that carries amber or clay. If a screen shows one, it is
 * telling the reader something needs them — the border is read before the words.
 */
export function Notice({ tone = 'problem', children }: { tone?: 'attention' | 'problem'; children: ReactNode }) {
  const c = tone === 'problem' ? 'border-clay text-clay' : 'border-amber text-amber';
  return (
    <p role="alert" className={`rounded-xl border ${c} bg-white px-4 py-3 text-[0.92rem] shadow-sm`}>
      {children}
    </p>
  );
}

export function PageHeader({ title, lede, action }: { title: string; lede?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[#d8e2db] pb-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#789087]">A-HEALTH / DAKTARI</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {lede && <p className="mt-1.5 max-w-[62ch] text-[0.95rem] text-ink-soft">{lede}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ children, accent = '', className = '' }: { children: ReactNode; accent?: string; className?: string }) {
  return <article className={`rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(16,36,31,0.06)] ${accent || 'border border-[#dfe8e1]'} ${className}`}>{children}</article>;
}

/**
 * An empty list is usually good news on a clinical console — no one waiting,
 * nothing overdue. The copy says so rather than reading like a failure.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-[#c8d8ce] bg-white/70 px-6 py-12 text-center text-ink-soft shadow-sm">{children}</div>;
}

export function Loading() {
  return <div className="flex items-center gap-3 rounded-2xl border border-[#dfe8e1] bg-white/75 px-6 py-12 text-ink-soft shadow-sm"><span className="h-2 w-2 animate-pulse rounded-full bg-petrol" /> Inapakia foleni...</div>;
}

export function Field({
  label, hint, children, htmlFor,
}: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export const inputClass = 'min-h-11 w-full border border-line bg-white px-3';
export const areaClass = 'w-full border border-line bg-white p-3';
