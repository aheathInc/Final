export const levels = ['country','region','district','ward','village'] as const;
export type Level = typeof levels[number];
export interface InsightArea { code:string;name:string;level:Level;parentCode:string|null;latitude:number|null;longitude:number|null }
export interface DiseaseInsight {
  code:string;name:string;cases:number|null;latestCases:number|null;previousCases:number|null;
  changeCases:number|null;changePercent:number|null;direction:'rising'|'falling'|'stable'|'unavailable';
  series:{period:string;cases:number|null}[];
}
export interface InsightReport {
  source:string;privacy:{minimumParticipants:number;rule:string};areas:InsightArea[];conditions:string[];conditionLabels:Record<string,string>;
  availablePeriods:string[];releases:{period:string;publishedAt:string}[];
  totalCases:number|null;unlocatedCases:number|null;
  distribution:(InsightArea & {cases:number|null;leadingDisease:{code:string;name:string;cases:number|null}|null})[];
  diseaseComparison:{latestPeriod:string|null;previousPeriod:string|null};
  diseases:DiseaseInsight[];
  trend:{period:string;cases:number|null;areas:{code:string;cases:number|null}[]}[];
}
export const caseCount = (n:number|null) => n === null ? 'Unavailable' : new Intl.NumberFormat('en-TZ').format(n);
