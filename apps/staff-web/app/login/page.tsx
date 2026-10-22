'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button, Field, Notice, inputClass } from '@/components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function staffSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await signIn('credentials', {
      kind: 'staff',
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl: '/',
    });
    if (res?.error) {
      setError('Invalid email or password.');
      setBusy(false);
      return;
    }
    window.location.assign('/');
  }

  return (
    <div className="grid min-h-screen bg-navy text-white lg:grid-cols-[0.9fr_1.1fr]">
      <section className="flex min-h-[34vh] flex-col justify-between px-6 py-8 sm:px-10 lg:min-h-screen lg:px-14">
        <div>
          <div className="grid size-12 place-items-center rounded-lg bg-teal text-navy">
            <span className="text-xl font-semibold">A</span>
          </div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-teal">A-health</p>
          <h1 className="mt-3 max-w-md text-3xl font-semibold tracking-tight sm:text-4xl">
            Unified staff workspace
          </h1>
          <p className="mt-3 max-w-sm text-sm text-slate-300">
            Clinician care, operations and analytics access for authorised staff.
          </p>
        </div>
        <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">Doctor / Clinician</div>
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">Admin / Operations</div>
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">Analytics / Research</div>
        </div>
      </section>

      <section className="flex items-center justify-center bg-paper px-6 py-10 text-ink">
        <form onSubmit={staffSignIn} className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-line bg-white p-6 shadow-xl">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Staff sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Use clinician or platform administrator credentials.</p>
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
        </form>
      </section>
    </div>
  );
}
