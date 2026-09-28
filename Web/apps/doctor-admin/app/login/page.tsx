'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, Field, Notice, inputClass } from '@/components/ui';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await signIn('credentials', { email, password, redirect: false });
    if (res?.error) {
      // Does not say which of the two was wrong: confirming that an email
      // exists is a free answer an attacker should not get.
      setError('Barua pepe au nywila si sahihi.');
      setBusy(false);
      return;
    }
    router.push('/queue');
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">A-health</h1>
      <p className="mt-2 text-ink-soft">Ingia kwenye akaunti yako ya daktari.</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Barua pepe" htmlFor="email">
          <input id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nywila" htmlFor="password">
          <input id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>

        {error && <Notice>{error}</Notice>}

        <Button type="submit" disabled={busy} className="mt-2 w-full">
          {busy ? 'Inaingia...' : 'Ingia'}
        </Button>
      </form>
    </div>
  );
}
