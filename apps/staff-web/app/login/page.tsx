'use client';

import { useState } from 'react';
import { clinicalArtwork } from '@/lib/premium/artwork';
import { signIn } from 'next-auth/react';
import { DisplayPreferences } from '@/components/premium/DisplayPreferences';
import { Icon } from '@/components/premium/Icon';
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
    <div className="ahp-login">
      <section className="ahp-login-story"><div className="ahp-brand"><span className="ahp-brand-mark"><Icon name="heart" size={23}/></span>A-Health</div>
        <div className="ahp-login-intro"><p>One connected care workspace</p><h1>Care, clearly connected.</h1><p>A calm, secure space for your clinical teams. Put people first, coordinate with confidence, and keep care moving.</p></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ahp-login-art" src={clinicalArtwork.overview.src} alt="" width="440" height="240"/>
        <footer>People. Care. Connect.</footer>
      </section>
      <section className="ahp-login-form-area"><DisplayPreferences/><form onSubmit={staffSignIn} className="ahp-login-form"><span className="ahp-eyebrow">Authorized staff access</span><h2>Welcome back.</h2><p>Sign in to your A-Health workspace with your staff account.</p>
        <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} className={inputClass}/></Field>
        <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} className={inputClass}/></Field>
        {error&&<Notice>{error}</Notice>}<Button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}<Icon name="arrow" size={16}/></Button><span className="ahp-login-note"><Icon name="lock" size={13}/>Your role determines your workspace access.</span>
      </form></section>
    </div>
  );
}
