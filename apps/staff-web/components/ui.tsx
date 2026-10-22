import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * min-height 2.75rem throughout is not a style preference: it is roughly the
 * smallest target a thumb hits reliably, and a good deal of this console is
 * used on a phone between patients.
 */
export function Button({
  children, variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  const base = 'inline-flex min-h-11 items-center justify-center gap-2 px-5 py-2.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-petrol';
  const kind =
    variant === 'primary' ? 'bg-petrol text-white shadow-sm shadow-petrol/20 hover:bg-petrol-lift'
    : variant === 'danger' ? 'bg-clay text-white shadow-sm shadow-clay/20 hover:opacity-90'
    : 'border border-line bg-white text-petrol shadow-sm hover:border-petrol hover:bg-teal/10 hover:text-petrol-lift';
  return <button className={`${base} rounded-md ${kind} ${className}`} {...props}>{children}</button>;
}

export function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`staff-page px-4 py-6 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

/**
 * The only component that carries amber or clay. If a screen shows one, it is
 * telling the reader something needs them — the border is read before the words.
 */
export function Notice({ tone = 'problem', children }: { tone?: 'attention' | 'problem'; children: ReactNode }) {
  const c = tone === 'problem' ? 'border-clay text-clay' : 'border-amber text-amber';
  return (
    <p role="alert" className={`rounded-md border-l-4 ${c} bg-paper-sunk py-3 pl-4 pr-3 text-[0.95rem]`}>
      {children}
    </p>
  );
}

export function PageHeader({ title, lede, action }: { title: string; lede?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line/80 pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {lede && <p className="mt-1 max-w-[62ch] text-[0.95rem] text-ink-soft">{lede}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ children, accent = '', className = '' }: { children: ReactNode; accent?: string; className?: string }) {
  return <article className={`rounded-lg bg-white/95 p-4 shadow-sm shadow-navy/5 ring-1 ring-black/5 ${accent || 'border border-line'} ${className}`}>{children}</article>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'attention' | 'problem' | 'info' }) {
  const toneClass =
    tone === 'good' ? 'border-teal/40 bg-teal/10 text-petrol'
    : tone === 'attention' ? 'border-amber/40 bg-amber/10 text-amber'
    : tone === 'problem' ? 'border-clay/40 bg-clay/10 text-clay'
    : tone === 'info' ? 'border-blue/40 bg-blue/10 text-blue'
    : 'border-line bg-paper-sunk text-ink-soft';
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{children}</h2>;
}

/**
 * An empty list is usually good news on a clinical console — no one waiting,
 * nothing overdue. The copy says so rather than reading like a failure.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-ink-soft">{children}</p>;
}

export function Loading() {
  return <p className="py-10 text-ink-soft">Loading...</p>;
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

export const inputClass = 'min-h-11 w-full rounded-md border border-line bg-white px-3 shadow-sm';
export const areaClass = 'w-full rounded-md border border-line bg-white p-3 shadow-sm';
