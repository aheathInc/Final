import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * min-height 2.75rem throughout is not a style preference: it is roughly the
 * smallest target a thumb hits reliably, and a good deal of this console is
 * used on a phone between patients.
 */
export function Button({
  children, variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  const base = 'min-h-11 px-5 py-2.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const kind =
    variant === 'primary' ? 'bg-petrol text-white hover:bg-petrol-lift'
    : variant === 'danger' ? 'bg-clay text-white hover:opacity-90'
    : 'text-petrol underline underline-offset-4 hover:text-petrol-lift';
  return <button className={`${base} ${kind} ${className}`} {...props}>{children}</button>;
}

/**
 * The only component that carries amber or clay. If a screen shows one, it is
 * telling the reader something needs them — the border is read before the words.
 */
export function Notice({ tone = 'problem', children }: { tone?: 'attention' | 'problem'; children: ReactNode }) {
  const c = tone === 'problem' ? 'border-clay text-clay' : 'border-amber text-amber';
  return (
    <p role="alert" className={`border-l-4 ${c} bg-paper-sunk py-3 pl-4 pr-3 text-[0.95rem]`}>
      {children}
    </p>
  );
}

export function PageHeader({ title, lede, action }: { title: string; lede?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {lede && <p className="mt-1 max-w-[62ch] text-[0.95rem] text-ink-soft">{lede}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ children, accent = '', className = '' }: { children: ReactNode; accent?: string; className?: string }) {
  return <article className={`bg-white p-4 ${accent || 'border border-line'} ${className}`}>{children}</article>;
}

/**
 * An empty list is usually good news on a clinical console — no one waiting,
 * nothing overdue. The copy says so rather than reading like a failure.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-ink-soft">{children}</p>;
}

export function Loading() {
  return <p className="py-10 text-ink-soft">Inapakia...</p>;
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
