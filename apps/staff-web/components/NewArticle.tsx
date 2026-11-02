'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem } from '@/lib/api';
import { Button, Field, Notice, areaClass, inputClass } from './ui';

interface Topic { slug: string; name: string }

/**
 * Drafting and publishing are two steps on purpose. A low-literacy, low-
 * bandwidth audience gets one chance to trust this content; publishing
 * unreviewed spends that trust before the platform has earned it.
 */
export function NewArticle({ topics }: { topics: Topic[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [topicSlug, setTopicSlug] = useState(topics[0]?.slug ?? '');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [guide,setGuide]=useState(false);
  const [sections,setSections]=useState<Record<string,string>>({});
  const [sourceUrl,setSourceUrl]=useState(''),[sourceTitle,setSourceTitle]=useState('');
  const guideLabels:Record<string,string>={causes:'Sababu',symptoms:'Dalili',prevention:'Kinga',diagnosis:'Uchunguzi',treatment:'Chaguo za matibabu',warning_signs:'Dalili za hatari'};
  const [language, setLanguage] = useState('sw');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSlug, setDraftSlug] = useState<string | null>(null);

  if (topics.length === 0) {
    return <p className="mt-4 text-sm text-ink-soft">Hakuna mada iliyoundwa bado. Msimamizi anahitajika kuunda mada.</p>;
  }

  if (!open) {
    return <div className="mt-4"><Button onClick={() => setOpen(true)}>Andika makala</Button></div>;
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/education/articles',
        { topic_slug: topicSlug, slug, title, summary, body, language, ...(guide?{disease_guide:sections,sources:[{title:sourceTitle,url:sourceUrl}]}:{}) }, idem());
      setDraftSlug(slug);
    } catch (e) {
      setError(errorMessage(e, 'Rasimu haikuhifadhiwa.'));
    } finally { setBusy(false); }
  }

  async function publish() {
    if (!draftSlug) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/education/articles/${draftSlug}/publish?language=${language}`, {}, idem());
      setOpen(false); setDraftSlug(null);
      setSlug(''); setTitle(''); setSummary(''); setBody('');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Haikuchapishwa.'));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={saveDraft} className="mt-4 flex flex-col gap-3 border border-line bg-white p-4">
      <fieldset disabled={!!draftSlug||busy} className="contents"><div className="flex flex-wrap gap-3">
        <Field label="Mada" htmlFor="tp">
          <select id="tp" value={topicSlug} onChange={(e) => setTopicSlug(e.target.value)} className={inputClass}>
            {topics.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Lugha" htmlFor="lg">
          <select id="lg" value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
            <option value="sw">Kiswahili</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>
      <Field label="Kitambulisho (slug)" htmlFor="sl" hint="Herufi ndogo na vistari, mfano: malaria-kinga">
        <input id="sl" required pattern="[a-z0-9-]+" value={slug}
          onChange={(e) => setSlug(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Kichwa" htmlFor="ti">
        <input id="ti" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Muhtasari" htmlFor="su">
        <textarea id="su" required rows={2} value={summary}
          onChange={(e) => setSummary(e.target.value)} className={areaClass} />
      </Field>
      <Field label="Maudhui" htmlFor="bo">
        <textarea id="bo" rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={areaClass} />
      </Field>

      </fieldset><label className="flex gap-3"><input type="checkbox" disabled={!!draftSlug} checked={guide} onChange={e=>setGuide(e.target.checked)}/> Mwongozo wa ugonjwa wenye sehemu sita</label>
      {guide&&<>{Object.entries(guideLabels).map(([key,label])=><Field key={key} label={label} htmlFor={'guide-'+key}><textarea id={'guide-'+key} required disabled={!!draftSlug} rows={3} maxLength={6000} className={areaClass} value={sections[key]??''} onChange={e=>setSections({...sections,[key]:e.target.value})}/></Field>)}<Field label="Chanzo cha kitabibu" htmlFor="guide-source"><input id="guide-source" required disabled={!!draftSlug} className={inputClass} value={sourceTitle} onChange={e=>setSourceTitle(e.target.value)}/></Field><Field label="Kiungo cha chanzo (HTTPS)" htmlFor="guide-url"><input id="guide-url" type="url" pattern="https://.*" required disabled={!!draftSlug} className={inputClass} value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)}/></Field></>}
      {draftSlug&&<p>Ukichapisha, unathibitisha kuwa umepitia usahihi wa kitabibu, lugha rahisi na vyanzo vya rasimu iliyohifadhiwa.</p>}
      {error && <Notice>{error}</Notice>}

      {!draftSlug ? (
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>Hifadhi rasimu</Button>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Ghairi</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft">
            Rasimu imehifadhiwa. Haitaonekana kwa mgonjwa yeyote hadi ichapishwe.
          </p>
          <div className="flex gap-3">
            <Button type="button" onClick={publish} disabled={busy}>Chapisha</Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Acha kama rasimu</Button>
          </div>
        </div>
      )}
    </form>
  );
}
