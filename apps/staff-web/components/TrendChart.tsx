'use client';

import type { TrendSeries } from '@/lib/api';

/**
 * Drawn with plain SVG rather than a chart library: the series is a handful of
 * daily counts, and a dependency that ships a whole rendering engine for a
 * polyline is weight this audience — often on a slow connection — pays for
 * nothing.
 *
 * The expected band is not drawn, because it does not exist: no forecasting
 * model is deployed, so every point's expected_low and expected_high are null.
 * Drawing a band from the data itself would invent a baseline and make an
 * ordinary week look like a signal.
 */
export function TrendChart({ series }: { series: TrendSeries }) {
  const points = series.points;
  if (points.length === 0) {
    return <p className="mt-8 text-ink-soft">Hakuna mwelekeo wa kuonyesha kwa ugonjwa huu.</p>;
  }

  const w = 720;
  const h = 220;
  const pad = { top: 16, right: 16, bottom: 32, left: 44 };
  const max = Math.max(...points.map((p) => p.count), 1);
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.count)}`).join(' ');
  const ticks = [0, Math.round(max / 2), max];

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {series.condition_code} · {series.area_code ?? 'kitaifa'}
      </h2>

      <svg viewBox={`0 0 ${w} ${h}`} role="img"
        aria-label={`Mwelekeo wa ${series.condition_code}, siku ${points.length}`}
        className="mt-3 w-full border border-line bg-white">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} stroke="#D2D9D1" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#4A5F59">{t}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#0F4C43" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={p.period} cx={x(i)} cy={y(p.count)} r={3}
            fill={p.above_expected ? '#A63D2F' : '#0F4C43'} />
        ))}
        <text x={pad.left} y={h - 10} fontSize={11} fill="#4A5F59">{points[0].period}</text>
        <text x={w - pad.right} y={h - 10} textAnchor="end" fontSize={11} fill="#4A5F59">
          {points[points.length - 1].period}
        </text>
      </svg>

      <p className="mt-2 text-xs text-ink-soft">
        Mipaka ya matarajio haijachorwa: hakuna modeli ya utabiri iliyowekwa, kwa hiyo
        kila nukta ina matarajio matupu. Kuchora mstari kutoka kwenye data yenyewe
        kungetengeneza msingi wa uongo na kufanya wiki ya kawaida ionekane kama ishara.
      </p>
    </section>
  );
}
