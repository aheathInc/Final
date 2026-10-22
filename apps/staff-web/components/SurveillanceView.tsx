'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type ConditionCount, type GeoLevel, type TrendSeries } from '@/lib/api';
import { Empty, Field, Loading, Notice, inputClass } from './ui';
import { TrendChart } from './TrendChart';

const LEVELS: { value: GeoLevel; label: string }[] = [
  { value: 'national', label: 'Kitaifa' },
  { value: 'region', label: 'Mkoa' },
  { value: 'district', label: 'Wilaya' },
];

export function SurveillanceView() {
  const [level, setLevel] = useState<GeoLevel>('national');
  const [areaCode, setAreaCode] = useState('');
  const [conditions, setConditions] = useState<ConditionCount[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: ConditionCount[] }>('/surveillance/conditions', {
        params: { level, ...(areaCode ? { area_code: areaCode } : {}) },
      });
      setConditions(res.data?.data ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Data haikuweza kupakiwa.'));
    } finally { setLoading(false); }
  }, [level, areaCode]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setTrend(null); return; }
    void (async () => {
      try {
        const res = await api.get<TrendSeries>('/surveillance/trends', {
          params: { condition_code: selected, level, ...(areaCode ? { area_code: areaCode } : {}) },
        });
        setTrend(res.data);
      } catch {
        setTrend(null);
      }
    })();
  }, [selected, level, areaCode]);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Kiwango" htmlFor="lv">
          <select id="lv" value={level} onChange={(e) => { setLevel(e.target.value as GeoLevel); setSelected(null); }}
            className={inputClass}>
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Field>
        {level !== 'national' && (
          <Field label="Msimbo wa eneo" htmlFor="ac" hint="Mfano: DAR, ARU, MWZ">
            <input id="ac" value={areaCode} onChange={(e) => { setAreaCode(e.target.value.toUpperCase()); setSelected(null); }}
              className={inputClass} />
          </Field>
        )}
      </div>

      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {loading ? <Loading /> : conditions.length === 0 ? (
        <Empty>
          Hakuna data ya eneo hili. Hesabu hutokana na vipimo vya madaktari, kwa hiyo eneo
          lisilo na matibabu yaliyoandikwa halitakuwa na chochote.
        </Empty>
      ) : (
        <table className="mt-6 w-full border border-line bg-white text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th className="p-3 font-medium">#</th>
              <th className="p-3 font-medium">Ugonjwa</th>
              <th className="p-3 font-medium">Idadi</th>
              <th className="p-3 font-medium">Kwa 100,000</th>
              <th className="p-3 font-medium">Mabadiliko</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((c, i) => (
              <tr key={c.condition_code}
                onClick={() => setSelected(c.condition_code === selected ? null : c.condition_code)}
                className={`cursor-pointer border-b border-line last:border-0 hover:bg-paper-sunk ${
                  selected === c.condition_code ? 'bg-paper-sunk' : ''
                }`}>
                <td className="p-3 font-mono tabular-nums text-ink-soft">{c.rank ?? i + 1}</td>
                <td className="p-3">{c.condition_name}</td>
                <td className="p-3 font-mono tabular-nums">{c.count.toLocaleString()}</td>
                {/*
                  Both of these are null for every row today: no population
                  denominator and no historical baseline are wired. An em dash
                  is honest; a computed-looking zero would not be.
                */}
                <td className="p-3 font-mono tabular-nums text-ink-soft">
                  {c.rate_per_100k ?? '—'}
                </td>
                <td className="p-3 font-mono tabular-nums text-ink-soft">
                  {c.change_percent ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {conditions.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          Bonyeza safu kuona mwelekeo wake kwa muda. Safu za &ldquo;kwa 100,000&rdquo; na
          &ldquo;mabadiliko&rdquo; ni tupu kwa sababu idadi ya watu na msingi wa kihistoria
          havijaunganishwa bado.
        </p>
      )}

      {trend && <TrendChart series={trend} />}
    </div>
  );
}
