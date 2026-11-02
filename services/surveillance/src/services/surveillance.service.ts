import { prisma } from '@a-health/database';
import { badRequest, forbidden } from '@a-health/http';
import { reportFromReleases, LEVELS, type AreaLevel, type ReleasePayload } from './regional-insights.policy.js';

export interface Caller { role: string }
type Query = { level:string;area_code?:string;from?:string;to?:string;condition_code?:string };
async function released(caller:Caller, query:Query) {
  if (!['platform_admin','clinician'].includes(caller.role)) throw forbidden('ROLE_NOT_PERMITTED','Aggregate surveillance data is not available to this role');
  const level = (query.level === 'national' ? 'country' : query.level) as AreaLevel;
  if (!LEVELS.includes(level)) throw badRequest('VALIDATION_FAILED','Choose country, region, district, ward or village.');
  for (const value of [query.from,query.to]) if (value && !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) throw badRequest('VALIDATION_FAILED','Use a calendar month or ISO date.');
  const releases = await prisma.regionalInsightRelease.findMany({
    where:{period:{...(query.from?{gte:query.from.slice(0,7)}:{}),...(query.to?{lte:query.to.slice(0,7)}:{})}},orderBy:{period:'asc'},
  });
  const payloads=releases.map(r=>({...r,payload:r.payload as unknown as ReleasePayload}));
  const codes=new Set(payloads.flatMap(r=>r.payload.areas.map(a=>a.code)));
  const area=query.area_code && !codes.has(query.area_code) && codes.has('recorded-region:'+query.area_code)?'recorded-region:'+query.area_code:query.area_code;
  if(area&&!codes.has(area))return reportFromReleases([],{level});
  try {
    return reportFromReleases(payloads,{level,area,condition:query.condition_code});
  } catch(e) { throw badRequest('VALIDATION_FAILED',(e as Error).message); }
}
/** Compatibility endpoints expose the SAME immutable protected releases, never raw rollups. */
export async function getConditions(caller:Caller, query:Query) {
  const report = await released(caller,query);
  return {data:report.diseases.map((d,i)=>({condition_code:d.code,condition_name:d.name,count:d.cases,rate_per_100k:null,rank:i+1,change_percent:null})),privacy:report.privacy};
}
export async function getTrends(caller:Caller, query:Query & {condition_code:string}) {
  const report = await released(caller,query);
  return {condition_code:query.condition_code,level:query.level,area_code:query.area_code??null,
    points:report.trend.map(p=>({period:p.period+'-01',count:p.cases,expected_low:null,expected_high:null,above_expected:false})),model_version:null,privacy:report.privacy};
}
