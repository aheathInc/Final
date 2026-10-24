import { TABLES, TABLE_MAP } from './catalog.js';
import type { CdmRow } from './sql.js';
import type { BuildInput, Vocabulary, IdMap, QualityIssue, QualityReport } from './types.js';
import { mergeBundles } from './bundle.js';
import { check, keyed, sha } from '../portal/policy.js';
import type { Cell } from '../portal/types.js';
export const ETL_VERSION='ahp-omop-5.4-etl-v1';
const clinical:Record<string,{concept:string;domain:string;date:string;source:string;portal:string}>={
  condition_occurrence:{concept:'condition_concept_id',domain:'Condition',date:'condition_start_date',source:'condition_source_value',portal:'condition'},
  drug_exposure:{concept:'drug_concept_id',domain:'Drug',date:'drug_exposure_start_date',source:'drug_source_value',portal:'drug'},
  procedure_occurrence:{concept:'procedure_concept_id',domain:'Procedure',date:'procedure_date',source:'procedure_source_value',portal:'procedure'},
  device_exposure:{concept:'device_concept_id',domain:'Device',date:'device_exposure_start_date',source:'device_source_value',portal:'observation'},
  measurement:{concept:'measurement_concept_id',domain:'Measurement',date:'measurement_date',source:'measurement_source_value',portal:'measurement'},
  observation:{concept:'observation_concept_id',domain:'Observation',date:'observation_date',source:'observation_source_value',portal:'observation'},
  specimen:{concept:'specimen_concept_id',domain:'Specimen',date:'specimen_date',source:'specimen_source_value',portal:'observation'},
};
const domains:Record<string,string>={Person:'person',Condition:'condition_occurrence',Drug:'drug_exposure',Procedure:'procedure_occurrence',Device:'device_exposure',Measurement:'measurement',Observation:'observation',Visit:'visit_occurrence',Specimen:'specimen',Episode:'episode'};
const day=(v:unknown)=>new Date(String(v).slice(0,10)+'T00:00:00Z').getTime();
export function conceptIsValid(v:Vocabulary,id:number,date:string,domain?:string,standard=false):boolean{
  const c=v.concepts.get(id);if(!c)return false;if(id===0)return !standard;
  return !c.invalid_reason&&c.valid_start_date<=date&&c.valid_end_date>=date&&(!domain||c.domain_id===domain)&&(!standard||c.standard_concept==='S');
}
function eventTable(v:Vocabulary,field:unknown):string|undefined{
  const c=v.concepts.get(Number(field));if(!c)return;const code=c.concept_code.toLowerCase();
  for(const t of TABLES)if(t.primaryKey&&code===t.name+'.'+t.primaryKey)return t.name;
}
export function identityReferences(table:string,row:CdmRow,v:Vocabulary):Map<string,string>{
  const out=new Map<string,string>(),spec=TABLE_MAP.get(table)!;
  if(spec.primaryKey&&!spec.vocabulary)out.set(spec.primaryKey,table);
  for(const c of spec.columns)if(c.references&&c.references[0]!=='concept'&&!TABLE_MAP.get(c.references[0])?.vocabulary)out.set(c.name,c.references[0]);
  if(table==='cost'){const target=domains[String(row.cost_domain_id)];check(target,422,'UNKNOWN_EVENT_DOMAIN','Cost must reference a supported clinical domain.');out.set('cost_event_id',target);}
  if(table==='fact_relationship')for(const n of [1,2]){const target=domains[v.domains.get(Number(row['domain_concept_id_'+n]))??''];check(target,422,'UNKNOWN_EVENT_DOMAIN','Fact relationship domain cannot be resolved.');out.set('fact_id_'+n,target);}
  const polymorphic:Record<string,[string,string]>={measurement:['measurement_event_id','meas_event_field_concept_id'],observation:['observation_event_id','obs_event_field_concept_id'],episode_event:['event_id','episode_event_field_concept_id']};
  const pair=polymorphic[table];if(pair&&row[pair[0]]!==null&&row[pair[0]]!==undefined){const target=eventTable(v,row[pair[1]]);check(target,422,'UNKNOWN_EVENT_FIELD','An event link requires a valid CDM field concept.');out.set(pair[0],target);}
  return out;
}
export function mappingKeys(tables:Record<string,CdmRow[]>,v:Vocabulary):string[]{
  const keys=new Set<string>();for(const [t,rows]of Object.entries(tables))for(const row of rows)for(const [col,target]of identityReferences(t,row,v))if(row[col]!==null&&row[col]!==undefined)keys.add(target+':'+row[col]);return [...keys].sort();
}
export function planTables(input:BuildInput,v:Vocabulary,ids:IdMap,maxRows:number):Record<string,CdmRow[]> {
  const raw=mergeBundles(input.bundles,maxRows),tables:Record<string,CdmRow[]>={};
  for(const spec of TABLES)tables[spec.name]=[];
  for(const [t,rows]of Object.entries(raw)){
    tables[t]=rows.map(original=>{
      const row={...original},meta=clinical[t];
      if(meta&&(!row[meta.concept]||row[meta.concept]===0)&&row._code_system&&row[meta.source]){
        const map=input.mappings.find(m=>m.system===row._code_system&&m.sourceCode===row[meta.source]&&m.domain===meta.portal&&m.standardConcept&&m.vocabularyVersion===v.version);
        check(map,422,'UNMAPPED_SOURCE_CODE','Map every clinical source code against the active vocabulary before building.');row[meta.concept]=map.conceptId;
      }
      delete row._code_system;
      const refs=identityReferences(t,row,v);
      for(const [col,target]of refs)if(row[col]!==null&&row[col]!==undefined){const newId=ids.get(target+':'+row[col]);check(newId&&newId<=2147483647,422,'IDENTITY_MAP_REQUIRED','Stable warehouse identity mapping is incomplete.');row[col]=newId;}
      // Clinical source values are retained only if they match a loaded concept or an approved local mapping.
      for(const col of Object.keys(row).filter(c=>c.endsWith('_source_value')||c==='dose_unit_source_value')){
        const value=row[col];if(value===null)continue;
        if(col==='country_source_value')continue;
        const conceptCol=col.replace('_source_value','_source_concept_id');const originalConcept=v.concepts.get(Number(row[conceptCol]));
        const isClinical=meta&&col===meta.source;const standard=isClinical?v.concepts.get(Number(row[meta.concept])):undefined;
        const mapped=input.mappings.some(m=>m.sourceCode===value&&m.system===original._code_system&&m.vocabularyVersion===v.version&&m.conceptId===row[meta?.concept??'']);
        if(!(originalConcept?.concept_code===value||standard?.concept_code===value||mapped))row[col]=null;
      }
      if(t==='person')row.person_source_value=keyed(input.linkageKey,'omop-public-person',input.datasetId,input.sourceId,String(original.person_id)).slice(0,40);
      return row;
    });
  }
  mergeObservationPeriods(tables);
  if(!tables.condition_era.length)tables.condition_era=eras(tables.condition_occurrence,'condition',v);
  if(!tables.drug_era.length)tables.drug_era=eras(tables.drug_exposure,'drug',v);
  // All dates for a person receive one deterministic offset. No invented exact birth dates.
  if(input.datePolicy==='shifted_dates')for(const spec of TABLES.filter(t=>!t.vocabulary))for(const row of tables[spec.name]){
    if(!row.person_id)continue;const h=keyed(input.linkageKey,'omop-date-shift',input.datasetId,input.sourceId,String(row.person_id));const offset=(parseInt(h.slice(0,8),16)%361)-180;
    for(const c of spec.columns)if(row[c.name]&&(c.type==='date'||c.type==='timestamp')){const date=new Date(String(row[c.name])+(c.type==='date'?'T00:00:00Z':''));date.setUTCDate(date.getUTCDate()+offset);row[c.name]=c.type==='date'?date.toISOString().slice(0,10):date.toISOString();}
  }
  return tables;
}
function mergeObservationPeriods(tables:Record<string,CdmRow[]>) {
  const grouped=new Map<number,CdmRow[]>();for(const row of tables.observation_period){const p=Number(row.person_id);if(!grouped.has(p))grouped.set(p,[]);grouped.get(p)!.push(row);}
  const result:CdmRow[]=[];
  for(const rows of grouped.values()){
    rows.sort((a,b)=>String(a.observation_period_start_date).localeCompare(String(b.observation_period_start_date)));
    for(const row of rows){const last=result[result.length-1];if(last&&last.person_id===row.person_id&&day(row.observation_period_start_date)<=day(last.observation_period_end_date)+86400000){check(last.period_type_concept_id===row.period_type_concept_id,422,'OBSERVATION_PERIOD_CONFLICT','Overlapping periods have different provenance types.');if(day(row.observation_period_end_date)>day(last.observation_period_end_date))last.observation_period_end_date=row.observation_period_end_date;}else result.push({...row});}
  }
  tables.observation_period=result;
}
/** Ingredient-level drug eras and condition eras; 30-day non-stockpiling persistence window. */
export function eras(events:CdmRow[],kind:'condition'|'drug',v:Vocabulary):CdmRow[]{
  const grouped=new Map<string,{person:number;concept:number;events:{start:string;end:string}[]}>();
  for(const row of events){const id=Number(row[kind+'_concept_id']);let targets=[id];
    if(kind==='drug'){
      const concept=v.concepts.get(id);
      targets=concept?.concept_class_id==='Ingredient'?[id]:[...new Set(v.ancestors.filter(a=>a.descendant_concept_id===id&&v.concepts.get(a.ancestor_concept_id)?.concept_class_id==='Ingredient').map(a=>a.ancestor_concept_id))];
      check(targets.length>0,422,'INGREDIENT_MAPPING_REQUIRED','Every drug exposure needs a vocabulary ingredient mapping.');
    }
    const start=String(row[kind==='drug'?'drug_exposure_start_date':'condition_start_date']),end=String(row[kind==='drug'?'drug_exposure_end_date':'condition_end_date']??start);
    for(const concept of targets){const key=row.person_id+':'+concept;if(!grouped.has(key))grouped.set(key,{person:Number(row.person_id),concept,events:[]});grouped.get(key)!.events.push({start,end});}
  }
  const result:CdmRow[]=[];let id=1;
  for(const [,g]of [...grouped].sort(([a],[b])=>a.localeCompare(b))){g.events.sort((a,b)=>a.start.localeCompare(b.start));let current:{start:string;end:string;count:number;gaps:number}|null=null;
    const emit=()=>{if(!current)return;result.push({[kind+'_era_id']:id++,person_id:g.person,[kind+'_concept_id']:g.concept,[kind+'_era_start_date']:current.start,[kind+'_era_end_date']:current.end,[kind==='drug'?'drug_exposure_count':'condition_occurrence_count']:current.count,...(kind==='drug'?{gap_days:current.gaps}:{})});};
    for(const event of g.events){const gap=current?Math.max(0,Math.round((day(event.start)-day(current.end))/86400000)-1):0;
      if(current&&gap<=30){current.count++;current.gaps+=gap;if(event.end>current.end)current.end=event.end;}else{emit();current={start:event.start,end:event.end,count:1,gaps:0};}}
    emit();
  }return result;
}
export function quality(tables:Record<string,CdmRow[]>,v:Vocabulary,date=new Date().toISOString().slice(0,10)):QualityReport{
  const issues=new Map<string,QualityIssue>();const fail=(test:string,t:string,c?:string,severity:'error'|'warning'='error')=>{const key=[test,t,c,severity].join(':');const prev=issues.get(key);if(prev)prev.count++;else issues.set(key,{check:test,table:t,...(c?{column:c}:{}),count:1,severity});};
  const pks=new Map(TABLES.filter(t=>t.primaryKey&&!t.vocabulary).map(t=>[t.name,new Set((tables[t.name]??[]).map(r=>r[t.primaryKey!]))]));
  const people=new Map((tables.person??[]).map(p=>[p.person_id,p]));const visits=new Map((tables.visit_occurrence??[]).map(p=>[p.visit_occurrence_id,p]));
  for(const spec of TABLES.filter(t=>!t.vocabulary)){
    if(!tables[spec.name]){fail('table_present',spec.name);continue;}const seen=new Set<unknown>();
    for(const row of tables[spec.name]){
      if(spec.primaryKey){if(seen.has(row[spec.primaryKey]))fail('unique_primary_key',spec.name,spec.primaryKey);seen.add(row[spec.primaryKey]);}
      for(const c of spec.columns){const value=row[c.name];if(c.required&&(value===null||value===undefined))fail('required_value',spec.name,c.name);
        if(value===null||value===undefined)continue;
        if(c.references){const [t]=c.references;if(t==='concept'){
          const isMain=clinical[spec.name]?.concept===c.name;let domain=isMain?clinical[spec.name].domain:undefined;
          if(c.name==='unit_concept_id')domain='Unit';if(c.name==='gender_concept_id')domain='Gender';if(c.name==='race_concept_id')domain='Race';if(c.name==='ethnicity_concept_id')domain='Ethnicity';
          if(c.name.endsWith('_type_concept_id'))domain='Type Concept';
          if(!conceptIsValid(v,Number(value),date,domain,!!isMain))fail('valid_concept_domain',spec.name,c.name);
        }else if(!TABLE_MAP.get(t)?.vocabulary&&!pks.get(t)?.has(value))fail('foreign_key',spec.name,c.name);}
        if(c.type==='integer'&&(!Number.isInteger(value)||Number(value)<-2147483648||Number(value)>2147483647))fail('integer_type',spec.name,c.name);
        if(c.type==='numeric'&&(typeof value!=='number'||!Number.isFinite(value)))fail('numeric_type',spec.name,c.name);
        if(c.name.includes('_start_date')){const end=c.name.replace('_start_date','_end_date');if(row[end]&&day(row[end])<day(value))fail('start_before_end',spec.name,c.name);}
        if(c.name==='procedure_date'&&row.procedure_end_date&&day(row.procedure_end_date)<day(value))fail('start_before_end',spec.name,c.name);
        if(['quantity','days_supply','refills','gap_days','drug_exposure_count','condition_occurrence_count'].includes(c.name)&&Number(value)<0)fail('non_negative',spec.name,c.name);
      }
      if(spec.name==='person'&&(!Number.isInteger(row.year_of_birth)||Number(row.year_of_birth)<1800||Number(row.year_of_birth)>Number(date.slice(0,4))))fail('birth_year',spec.name,'year_of_birth');
      if(row.visit_occurrence_id&&row.person_id&&visits.get(row.visit_occurrence_id)?.person_id!==row.person_id)fail('visit_person_consistency',spec.name);
      if(spec.name==='measurement'&&row.range_low!==null&&row.range_high!==null&&row.range_low!==undefined&&row.range_high!==undefined&&Number(row.range_low)>Number(row.range_high))fail('reference_range',spec.name);
      if(['drug_era','dose_era'].includes(spec.name)&&v.concepts.get(Number(row.drug_concept_id))?.concept_class_id!=='Ingredient')fail('ingredient_era',spec.name);
      const main=clinical[spec.name];if(main&&row.person_id){const p=people.get(row.person_id);if(p&&Number(String(row[main.date]).slice(0,4))<Number(p.year_of_birth)-1)fail('after_birth',spec.name,main.date);}
      // Resolve polymorphic event links against the correct target table, not just any integer.
      try{for(const [col,target]of identityReferences(spec.name,row,v))if(col!==spec.primaryKey&&row[col]!==null&&row[col]!==undefined&&!pks.get(target)?.has(row[col]))fail('event_link',spec.name,col);}catch{fail('event_link_domain',spec.name);}
    }
  }
  for(const p of people.keys())if(!(tables.observation_period??[]).some(r=>r.person_id===p))fail('person_observation_period','person');
  const checks=['table_present','required_value','unique_primary_key','foreign_key','valid_concept_domain','integer_type','numeric_type','start_before_end','non_negative','birth_year','visit_person_consistency','reference_range','ingredient_era','after_birth','event_link','event_link_domain','person_observation_period'];
  return {version:ETL_VERSION,passed:![...issues.values()].some(i=>i.severity==='error'),checks_executed:checks,issues:[...issues.values()],table_counts:Object.fromEntries(TABLES.map(t=>[t.name,(tables[t.name]??[]).length])),ohdsi_dqd_run:false};
}
export function aggregateTables(tables:Record<string,CdmRow[]>,v:Vocabulary,minimum:number):{cells:Cell[];withheld:number}{
  const people=new Map(tables.person.map(p=>[p.person_id,p])),locations=new Map(tables.location.map(l=>[l.location_id,l]));
  const groups=new Map<string,{cell:Omit<Cell,'participants'>;people:Set<unknown>}>();
  for(const [name,m]of Object.entries(clinical))for(const event of tables[name]){
    const p=people.get(event.person_id);if(!p)continue;const age=Number(String(event[m.date]).slice(0,4))-Number(p.year_of_birth);const date=String(event[m.date]);const concept=v.concepts.get(Number(event[m.concept]));if(!concept)continue;
    const location=locations.get(p.location_id);const region=location?.county??(location?.state?'TZ-'+location.state:'unknown');
    const cell={age_band:age>=90?'90+':`${Math.floor(Math.max(age,0)/10)*10}-${Math.floor(Math.max(age,0)/10)*10+9}`,sex:p.gender_concept_id===8532?'female':p.gender_concept_id===8507?'male':'unknown',region:String(region),period:date.slice(0,4)+'-Q'+Math.ceil(Number(date.slice(5,7))/3),domain:m.portal,code_system:concept.vocabulary_id,code:String(concept.concept_id),label:concept.concept_name};
    const key=JSON.stringify(cell);if(!groups.has(key))groups.set(key,{cell,people:new Set()});groups.get(key)!.people.add(p.person_id);
  }
  const cells:Cell[]=[];let withheld=0;for(const g of groups.values())if(g.people.size>=minimum)cells.push({...g.cell,participants:g.people.size});else withheld++;
  cells.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return {cells,withheld};
}
export function tableDigest(rows:CdmRow[],table:string):string{
  const columns=TABLE_MAP.get(table)!.columns;const values=rows.map(r=>JSON.stringify(columns.map(c=>{const v=r[c.name];return v===null||v===undefined?null:c.type==='timestamp'?new Date(String(v)).toISOString():c.type==='date'?String(v).slice(0,10):v;}))).sort();return sha(values.join('\n'));
}
