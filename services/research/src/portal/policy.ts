import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { Cell, CodeMapping, Filters, FormField, SafeEvent } from './types.js';

export class PortalError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export function check(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new PortalError(status, code, message);
}
export function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 422, 'INVALID_INPUT', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
export function keys(input: Record<string, unknown>, allowed: string[]) {
  check(Object.keys(input).every(k => allowed.includes(k)), 422, 'INVALID_FIELD', 'One or more fields are not permitted.');
}
export function text(input: Record<string, unknown>, field: string, min = 1, max = 150): string {
  const v = input[field];
  check(typeof v === 'string' && v.trim().length >= min && v.trim().length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), 422, 'INVALID_INPUT', `Invalid ${field}.`);
  return v.trim();
}
export function optionalText(input: Record<string, unknown>, field: string, max = 150): string|null {
  return input[field] === null || input[field] === undefined || input[field] === '' ? null : text(input, field, 1, max);
}
export function oneOf<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  check(typeof value === 'string' && choices.includes(value as T), 422, 'INVALID_INPUT', `Invalid ${name}.`); return value as T;
}
export function id(value: unknown): string {
  check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value), 422, 'INVALID_ID', 'Invalid resource reference.'); return value;
}
export function instant(value: unknown, name: string): Date {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value), 422, 'INVALID_DATE', `${name} must be a UTC timestamp.`);
  const d = new Date(value); check(Number.isFinite(d.getTime()) && d.toISOString().slice(0,19) === value.slice(0,19), 422, 'INVALID_DATE', `Invalid ${name}.`); return d;
}
export function integer(value: unknown, min: number, max: number, name: string): number {
  check(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, 422, 'INVALID_INPUT', `Invalid ${name}.`); return value;
}
export function sha(value: string|Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function keyed(key: Buffer, purpose: string, ...parts: string[]) {
  return createHmac('sha256', key).update(JSON.stringify([purpose, ...parts])).digest('hex');
}
export function seal(value: string, key: Buffer, context: string): string {
  check(key.length === 32, 503, 'CONFIGURATION_REQUIRED', 'Research encryption is not configured.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`ahp-research-v1:${context}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}
export function unseal(value: string, key: Buffer, context: string): string {
  const [version, iv, tag, payload] = value.split('.');
  check(version === 'v1' && !!payload && key.length === 32, 503, 'ENCRYPTED_RECORD_INVALID', 'Protected research record is unavailable.');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(`ahp-research-v1:${context}`)); d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(payload, 'base64')), d.final()]).toString('utf8');
  } catch { throw new PortalError(503, 'ENCRYPTED_RECORD_INVALID', 'Protected research record is unavailable.'); }
}
export const DOMAINS = ['condition','measurement','drug','procedure','observation','imaging'] as const;
export const SYSTEMS = ['ICD10','ICD11','LOINC','RxNorm','SNOMED','CPT','LOCAL'] as const;
export const DIMENSIONS = ['age_band','sex','region','period','domain','code'] as const;
const domainTable: Record<string,string> = {condition:'CONDITION_OCCURRENCE', measurement:'MEASUREMENT',drug:'DRUG_EXPOSURE',procedure:'PROCEDURE_OCCURRENCE',observation:'OBSERVATION',imaging:'MEASUREMENT'};
export function omopReadiness(events: SafeEvent[]) {
  return {
    cdm_target: '5.4', output: 'mapping-readiness-only', network_study_ready: false,
    mapped: events.filter(e=>e.concept_id>0).length, unmapped:events.filter(e=>e.concept_id===0).length,
    targets: [...new Set(events.map(e=>domainTable[e.domain]))],
    blockers: ['This legacy aggregate feed cannot reconstruct person records or exact dates.', 'Use the separate OMOP warehouse pipeline with licensed vocabularies and structured clinical source data.', 'Person-level warehouse outputs require explicit study scope and independent output approval.'],
  };
}
/** Whitelist transformation; direct identifiers are discarded in memory. Free text is rejected, not claimed anonymized. */
export function transformEvent(raw: unknown, sourceId: string, datasetId: string, key: Buffer, mappings: CodeMapping[]): {eventHash: string; payloadHash: string; safe: SafeEvent} {
  const r=object(raw);
  keys(r,['event_id','subject_key','age','sex','region_code','event_date','domain','code_system','code','value','unit','dose','duration_days','name','phone','national_id','address','patient_id']);
  const eventId=text(r,'event_id',1,120), subject=text(r,'subject_key',1,120);
  const age=integer(r.age,0,125,'age'), sex=oneOf(r.sex,['female','male','other','unknown'],'sex');
  const region=text(r,'region_code',2,12); check(/^TZ-(?:0[1-9]|[12][0-9]|3[01])$/.test(region),422,'REGION_REQUIRED','Use an approved TZ region code; no street or GPS coordinates.');
  const date=text(r,'event_date',10,10), parsedDate=new Date(date+'T00:00:00Z'); check(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0,10)===date,422,'INVALID_DATE','Invalid event_date.');
  check(Number(date.slice(0,4))>=1900 && new Date(date).getTime()<=Date.now(),422,'INVALID_DATE','Future or unsupported dates are not accepted.');
  const domain=oneOf(r.domain,DOMAINS,'domain'), system=oneOf(r.code_system,SYSTEMS,'code_system');
  const code=text(r,'code',1,40); check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(code),422,'INVALID_CODE','A structured source code is required.');
  const number=(v:unknown,lo:number,hi:number): number|null=> {if(v===undefined||v===null)return null;check(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,422,'INVALID_VALUE','A numeric clinical value is invalid.');return v;};
  const unit=optionalText(r,'unit',24);check(unit===null||/^[a-zA-Z0-9%/.[\]{}_-]+$/.test(unit),422,'INVALID_UNIT','A coded unit is required.');
  const mapping=mappings.find(m=>m.system===system&&m.sourceCode===code&&m.domain===domain&&m.standardConcept&&m.conceptId>0);
  const safe:SafeEvent={subject_hash:keyed(key,'subject',datasetId,sourceId,subject),age_band:age>=90?'90+':`${Math.floor(age/10)*10}-${Math.floor(age/10)*10+9}`,sex,region,period:date.slice(0,4)+'-Q'+Math.ceil(Number(date.slice(5,7))/3),domain,code_system:system,code,value:number(r.value,-1e6,1e6),unit,dose:number(r.dose,0,1e6),duration_days:number(r.duration_days,0,36500),concept_id:mapping?.conceptId??0,mapping_version:mapping?.vocabularyVersion??null};
  return {eventHash:keyed(key,'event',datasetId,sourceId,eventId),payloadHash:sha(JSON.stringify(safe)),safe};
}
export function makeRelease(events: SafeEvent[], mappings: CodeMapping[], minimum: number): {cells:Cell[];withheld:number} {
  check(minimum>=10&&minimum<=100,422,'PRIVACY_THRESHOLD','Minimum cell size must be between 10 and 100.');
  const groups=new Map<string,{cell:Omit<Cell,'participants'>;people:Set<string>}>();
  for(const e of events){
    const m=mappings.find(x=>x.system===e.code_system&&x.sourceCode===e.code&&x.domain===e.domain&&x.standardConcept&&x.conceptId>0);
    // Unknown codes are not published (they might themselves encode identifiers).
    if(!m)continue;
    const cell={age_band:e.age_band,sex:e.sex,region:e.region,period:e.period,domain:e.domain,code_system:e.code_system,code:e.code,label:m.label};
    const k=JSON.stringify(cell);if(!groups.has(k))groups.set(k,{cell,people:new Set()});groups.get(k)!.people.add(e.subject_hash);
  }
  let withheld=0; const cells:Cell[]=[];
  for(const g of groups.values()){ if(g.people.size<minimum){withheld++;continue;} cells.push({...g.cell,participants:g.people.size}); }
  cells.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  check(cells.length<=5000,422,'RELEASE_TOO_LARGE','Use a smaller, reviewed release.');return {cells,withheld};
}
export function parseFilters(value: unknown): Filters {
  const f=object(value??{}); keys(f,[...DIMENSIONS]);const result:Filters={};
  for(const k of DIMENSIONS)if(f[k]!==undefined&&f[k]!=='')result[k]=text(f,k,1,40);
  return result;
}
export function filterCells(cells:Cell[],filters:Filters):Cell[] {
  // No regrouping, suppressed totals, exact-age queries or row-level queries.
  return cells.filter(c=>Object.entries(filters).every(([k,v])=>c[k as keyof Filters]===v));
}
export function safePdf(value: unknown): Buffer {
  check(typeof value==='string'&&value.length<=720000&&/^[A-Za-z0-9+/]+={0,2}$/.test(value),422,'INVALID_DOCUMENT','A base64 PDF under 512 KiB is required.');
  const buf=Buffer.from(value,'base64');check(buf.length<=524288&&buf.length>=12&&buf.toString('base64')===value,422,'INVALID_DOCUMENT','Invalid PDF size or encoding.');
  check(buf.subarray(0,5).toString()==='%PDF-'&&buf.subarray(-1024).includes(Buffer.from('%%EOF')),422,'INVALID_DOCUMENT','Invalid PDF signature.');
  // Header checks do not establish malware safety. The scanner must separately report clean.
  return buf;
}
export function parseFields(value: unknown):FormField[]{
  check(Array.isArray(value)&&value.length>0&&value.length<=20,422,'INVALID_FORM','Choose between 1 and 20 fields.');
  const seen=new Set<string>();return value.map(raw=>{const f=object(raw);keys(f,['key','label','type','required','min','max','choices']);const key=text(f,'key',1,40);check(/^[a-z][a-z0-9_]*$/.test(key)&&!/(name|phone|email|address|national|patient_id|date_of_birth|free_text)/i.test(key)&&!['participant','constructor','prototype','__proto__'].includes(key)&&!seen.has(key),422,'INVALID_FORM','Duplicate or identifying field key.');seen.add(key);
    const type=oneOf(f.type,['number','choice','boolean'],'field type');check(typeof f.required==='boolean',422,'INVALID_FORM','Required must be boolean.');
    const out:FormField={key,label:text(f,'label',1,100),type,required:f.required};
    if(type==='number'){const lo=f.min,hi=f.max;check(typeof lo==='number'&&typeof hi==='number'&&Number.isFinite(lo)&&Number.isFinite(hi)&&lo>=-10000&&hi<=10000&&lo<hi,422,'INVALID_FORM','Numeric fields require bounded minimum and maximum.');out.min=lo;out.max=hi;}
    if(type==='choice'){check(Array.isArray(f.choices)&&f.choices.length>=2&&f.choices.length<=20,422,'INVALID_FORM','Choice field requires 2–20 coded options.');out.choices=f.choices.map(v=>{check(typeof v==='string'&&/^[A-Za-z0-9_-]{1,30}$/.test(v),422,'INVALID_FORM','Use coded options, not free text.');return v;});check(new Set(out.choices).size===out.choices.length,422,'INVALID_FORM','Duplicate option.');}
    return out;});
}
export function validateAnswers(fields:FormField[],value:unknown):Record<string,number|string|boolean>{
  const a=object(value);keys(a,fields.map(f=>f.key));const out:Record<string,number|string|boolean>={};
  for(const f of fields){const v=a[f.key];if(v===undefined||v===null){check(!f.required,422,'REQUIRED_ANSWER',`Answer required: ${f.key}.`);continue;}
    if(f.type==='number')check(typeof v==='number'&&Number.isFinite(v)&&v>=f.min!&&v<=f.max!,422,'INVALID_ANSWER',`Invalid ${f.key}.`);
    if(f.type==='boolean')check(typeof v==='boolean',422,'INVALID_ANSWER',`Invalid ${f.key}.`);
    if(f.type==='choice')check(typeof v==='string'&&f.choices!.includes(v),422,'INVALID_ANSWER',`Invalid ${f.key}.`);
    out[f.key]=v as number|string|boolean;
  }return out;
}
