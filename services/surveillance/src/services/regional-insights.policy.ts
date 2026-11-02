export const LEVELS = ['country', 'region', 'district', 'ward', 'village'] as const;
export const MIN_PARTICIPANTS = 10;
export type AreaLevel = typeof LEVELS[number];
export interface Area {
  code: string; name: string; level: AreaLevel; parentCode: string | null;
  latitude: number | null; longitude: number | null;
}
export interface Cell { areaCode: string | null; conditionCode: string; cases: number }
export interface ReleasePayload { version: 1; areas: Area[]; cells: Cell[]; labels?: Record<string,string> }
export interface Release { period: string; publishedAt: Date; payload: ReleasePayload }

export function completedMonth(value: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value < '2020-01' || value >= now.toISOString().slice(0, 7)) {
    throw new Error('Use a completed calendar month from 2020 onwards (YYYY-MM).');
  }
  return value;
}

export function validateTree(areas: Area[]) {
  const index = new Map(areas.map(a => [a.code, a]));
  if (index.size !== areas.length) throw new Error('Area codes must be unique.');
  for (const area of areas) {
    const depth = LEVELS.indexOf(area.level);
    if (depth < 0 || (depth === 0 ? area.parentCode !== null : index.get(area.parentCode ?? '')?.level !== LEVELS[depth - 1])) {
      throw new Error('Every area must have a parent at the preceding geographic level.');
    }
  }
}

/** Only fixed base cells leave the private aggregation stage. No hidden counts or rankings. */
export function protectCells(rows: { areaCode: string | null; conditionCode: string; cases: number; participants: number }[]): Cell[] {
  return rows.filter(r => Number.isSafeInteger(r.participants) && r.participants >= MIN_PARTICIPANTS &&
    Number.isSafeInteger(r.cases) && r.cases >= r.participants && /^[A-Za-z0-9][A-Za-z0-9.\-]{1,39}$/.test(r.conditionCode))
    .map(({ areaCode, conditionCode, cases }) => ({ areaCode, conditionCode, cases }))
    .sort((a,b) => (a.areaCode ?? '').localeCompare(b.areaCode ?? '') || a.conditionCode.localeCompare(b.conditionCode));
}

/** All parent totals, comparisons, maps and filters sum the SAME already-published cells.
 * Never recompute a raw parent total: subtraction could reveal a suppressed child.
 * These are diagnosis-case counts, never unique patients across cells or prevalence.
 */
export function reportFromReleases(releases: Release[], filters: { area?: string; level: AreaLevel; condition?: string }) {
  releases = [...releases].sort((a,b)=>a.period.localeCompare(b.period));
  const areas = [...new Map(releases.flatMap(r => r.payload.areas).map(a => [a.code, a])).values()]
    .sort((a,b) => a.name.localeCompare(b.name));
  const index = new Map(areas.map(a => [a.code,a]));
  if (filters.area && !index.has(filters.area)) throw new Error('Select an area present in these published reports.');
  const ancestor = (code: string | null, level: AreaLevel) => {
    let a = code ? index.get(code) : undefined;
    for (let i = 0; a && i < LEVELS.length; i++) { if (a.level === level) return a; a = a.parentCode ? index.get(a.parentCode) : undefined; }
    return undefined;
  };
  const inside = (code: string | null) => !filters.area || ancestor(code, index.get(filters.area)!.level)?.code === filters.area;
  const conditions = [...new Set(releases.flatMap(r => r.payload.cells.map(c => c.conditionCode)))].sort();
  const conditionLabels = Object.fromEntries(conditions.map(code => {
    const names = [...new Set(releases.map(r=>r.payload.labels?.[code]).filter((name):name is string=>Boolean(name)))];
    return [code,names.length===1?names[0]:code];
  }));
  const selected = releases.map(r => ({ ...r, cells: r.payload.cells.filter(c => inside(c.areaCode) && (!filters.condition || c.conditionCode === filters.condition)) }));
  const sum = (cells: Cell[]) => cells.length ? cells.reduce((n,c) => n+c.cases,0) : null;
  const all = selected.flatMap(r => r.cells);
  const byArea = areas.filter(a => a.level === filters.level && inside(a.code)).map(a => ({
    ...a, cases: sum(all.filter(c => ancestor(c.areaCode, filters.level)?.code === a.code)),
  }));
  const diseases = conditions.map(code => ({ code, name:conditionLabels[code], cases: sum(all.filter(c => c.conditionCode === code)) }))
    .filter(c => c.cases !== null).sort((a,b) => b.cases! - a.cases! || a.code.localeCompare(b.code));
  const months: string[] = [];
  if (selected.length) {
    const cursor = new Date(selected[0].period+'-01T00:00:00Z');
    const end = selected[selected.length-1].period;
    while (cursor.toISOString().slice(0,7) <= end) { months.push(cursor.toISOString().slice(0,7)); cursor.setUTCMonth(cursor.getUTCMonth()+1); }
  }
  const latestPeriod = months.at(-1) ?? null;
  const priorDate = latestPeriod ? new Date(latestPeriod+'-01T00:00:00Z') : null;
  priorDate?.setUTCMonth(priorDate.getUTCMonth()-1);
  const previousPeriod = priorDate?.toISOString().slice(0,7) ?? null;
  const latestCells = selected.find(r=>r.period===latestPeriod)?.cells ?? [];
  const previousCells = selected.find(r=>r.period===previousPeriod)?.cells ?? [];
  const diseaseInsights = diseases.map(d => {
    const latestCases = sum(latestCells.filter(c=>c.conditionCode===d.code));
    const previousCases = sum(previousCells.filter(c=>c.conditionCode===d.code));
    const changeCases = latestCases!==null && previousCases!==null ? latestCases-previousCases : null;
    return {...d,latestCases,previousCases,changeCases,
      changePercent:changeCases!==null && previousCases!==null && previousCases>0 ? Math.round(changeCases/previousCases*1000)/10 : null,
      direction:changeCases===null?'unavailable':changeCases>0?'rising':changeCases<0?'falling':'stable',
      series:months.map(period=>({period,cases:sum((selected.find(r=>r.period===period)?.cells??[]).filter(c=>c.conditionCode===d.code))})),
    };
  });
  return {
    source: 'A-Health signed consultation diagnoses',
    privacy: { minimumParticipants: MIN_PARTICIPANTS, rule: 'Only published cells with at least 10 distinct patients contribute. Unavailable includes missing and suppressed data; it never means zero. Totals exclude withheld cells.' },
    areas, conditions, conditionLabels, filters,
    releases: releases.map(r => ({ period: r.period, publishedAt: r.publishedAt.toISOString() })),
    totalCases: sum(all),
    unlocatedCases: sum(all.filter(c => !ancestor(c.areaCode, filters.level))),
    distribution: byArea.map(a=>{
      const counts = conditions.map(code=>({code,name:conditionLabels[code],cases:sum(latestCells.filter(c=>c.conditionCode===code&&ancestor(c.areaCode,filters.level)?.code===a.code))}))
        .filter(d=>d.cases!==null).sort((a,b)=>b.cases!-a.cases!||a.code.localeCompare(b.code));
      return {...a,leadingDisease:counts[0]??null};
    }).sort((a,b) => (b.cases ?? -1)-(a.cases ?? -1) || a.name.localeCompare(b.name)),
    diseaseComparison:{latestPeriod,previousPeriod},
    diseases:diseaseInsights,
    trend: months.map(period => { const cells=selected.find(r=>r.period===period)?.cells??[]; return { period, cases:sum(cells),
      areas:byArea.map(a=>({code:a.code,cases:sum(cells.filter(c=>ancestor(c.areaCode,filters.level)?.code===a.code))})) }; }),
  };
}
