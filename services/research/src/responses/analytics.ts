import type { FormField, FormResponse } from '../portal/types.js';
import { check, object, keys, sha, keyed, validateAnswers } from '../portal/policy.js';
export interface ResponseCell { field:string;label:string;kind:string;bucket:string;lower:number|null;upper:number|null;participants:number }
export type AnalysisBins=Record<string,number[]>;
export interface ResponseDataset { cells:ResponseCell[];rows:Record<string,string|number|boolean|null>[];suppressedFields:string[];participantCount:number;bins:AnalysisBins }
export function responseFingerprint(rows:FormResponse[]):string {
  return sha(JSON.stringify(rows.map(r=>[r.id,r.version,r.status??'active',sha(r.ciphertext)]).sort(([a],[b])=>String(a).localeCompare(String(b)))));
}
export function parseBins(fields:FormField[],value:unknown):AnalysisBins{
  const input=object(value??{});keys(input,fields.filter(f=>f.type==='number').map(f=>f.key));const result:AnalysisBins={};
  for(const field of fields.filter(f=>f.type==='number')){
    let boundaries=input[field.key];
    if(boundaries===undefined)boundaries=Array.from({length:6},(_,i)=>Number((field.min!+(field.max!-field.min!)*i/5).toPrecision(12)));
    check(Array.isArray(boundaries)&&boundaries.length>=3&&boundaries.length<=11&&boundaries.every(b=>typeof b==='number'&&Number.isFinite(b)),422,'INVALID_BINS','Numeric fields require 2–10 predefined bounded bins.');
    const b=boundaries as number[];check(b[0]===field.min&&b[b.length-1]===field.max&&b.every((v,i)=>i===0||v>b[i-1]),422,'INVALID_BINS','Bins must cover the full approved range without overlap.');result[field.key]=b;
  }return result;
}
export function responseDataset(fields:FormField[],answers:Array<{subjectHash:string;answers:unknown}>,bins:AnalysisBins,k:number,key:Buffer,studyId:string,formId:string):ResponseDataset{
  check(k>=10&&k<=100,422,'PRIVACY_THRESHOLD','Minimum response group size is 10.');
  check(fields.every(f=>!['participant','constructor','prototype','__proto__'].includes(f.key)),422,'RESERVED_FIELD','Amend the form: a field conflicts with protected export metadata.');
  const participants=new Set<string>(),groups=new Map<string,Map<string,{lower:number|null;upper:number|null;people:Set<string>}>>();
  const rows:ResponseDataset['rows']=[];
  for(const item of answers){check(!participants.has(item.subjectHash),409,'DUPLICATE_RESPONDENT','Duplicate subject response in immutable form.');participants.add(item.subjectHash);const a=validateAnswers(fields,item.answers);
    const row:Record<string,string|number|boolean|null>={participant:keyed(key,'ecrf-release-participant',studyId,formId,item.subjectHash).slice(0,32)};
    for(const field of fields){const value=a[field.key];row[field.key]=value??null;let bucket='not_answered',lower:number|null=null,upper:number|null=null;
      if(value!==undefined){if(field.type==='number'){const bounds=bins[field.key];check(bounds,422,'INVALID_BINS','Missing numeric-bin definition.');let idx=bounds.findIndex((v,i)=>i<bounds.length-1&&Number(value)>=v&&(Number(value)<bounds[i+1]||(i===bounds.length-2&&Number(value)===bounds[i+1])));check(idx>=0,422,'INVALID_ANSWER','Numeric answer outside approved bins.');lower=bounds[idx];upper=bounds[idx+1];bucket=`${lower} ${idx===bounds.length-2?'to (inclusive)':'to (exclusive)'} ${upper}`;}else bucket=String(value);}
      if(!groups.has(field.key))groups.set(field.key,new Map());const g=groups.get(field.key)!;if(!g.has(bucket))g.set(bucket,{lower,upper,people:new Set()});g.get(bucket)!.people.add(item.subjectHash);
    }rows.push(row);
  }
  const cells:ResponseCell[]=[],suppressedFields:string[]=[];
  for(const field of fields){const g=groups.get(field.key)??new Map();
    // Whole-field suppression prevents a visible total or complementary category from revealing a rare answer.
    if([...g.values()].some(x=>x.people.size<k)||g.size===0){suppressedFields.push(field.key);continue;}
    for(const [bucket,x]of g)cells.push({field:field.key,label:field.label,kind:field.type,bucket,lower:x.lower,upper:x.upper,participants:x.people.size});
  }
  cells.sort((a,b)=>a.field.localeCompare(b.field)||(a.lower??0)-(b.lower??0)||a.bucket.localeCompare(b.bucket));rows.sort((a,b)=>String(a.participant).localeCompare(String(b.participant)));
  return {cells,rows,suppressedFields,participantCount:participants.size,bins};
}
