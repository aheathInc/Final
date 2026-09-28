'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button, Field, Notice, inputClass } from './ui';

export function ProfileForm({
  initialName, initialLanguage, email, phone,
}: { initialName: string; initialLanguage: string; email: string | null; phone: string | null }) {
  const [fullName, setFullName] = useState(initialName);
  const [language, setLanguage] = useState(initialLanguage);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.patch('/users/me', { full_name: fullName, preferred_language: language });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, 'Mabadiliko hayakuhifadhiwa.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <Field label="Jina kamili" htmlFor="fn">
        <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Lugha" htmlFor="lang">
        <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
          <option value="sw">Kiswahili</option>
          <option value="en">English</option>
        </select>
      </Field>

      {/* Changing these is an identity change, not a preference — it goes
          through verification rather than a settings form. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
        <div><dt className="inline">Barua pepe: </dt><dd className="inline">{email ?? '—'}</dd></div>
        <div><dt className="inline">Simu: </dt><dd className="inline">{phone ?? '—'}</dd></div>
      </dl>

      {saved && <p className="text-sm text-petrol">Imehifadhiwa.</p>}
      {error && <Notice>{error}</Notice>}

      <Button type="submit" disabled={busy} className="self-start">
        {busy ? 'Inahifadhi...' : 'Hifadhi'}
      </Button>
    </form>
  );
}
