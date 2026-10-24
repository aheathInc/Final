import { TABLES, TABLE_MAP } from './catalog.js';
import type { CdmRow } from './sql.js';
import type { CdmBundle } from './types.js';
import { check, keys, object, keyed } from '../portal/policy.js';
/** A restricted structured CDM input contract. The full warehouse schema includes note tables;
 * raw/free-text clinical notes are deliberately NOT a permitted ingestion channel. */
const forbiddenTables=new Set(['note','note_nlp','metadata','cdm_source','cohort','cohort_definition']);
const direct=new Set(['provider_name','npi','dea','care_site_name','address_1','address_2','city','zip','latitude','longitude','birth_datetime','month_of_birth','day_of_birth','unique_device_id','production_id','lot_number','specimen_source_id','sig','value_as_string','stop_reason']);
const clinicalSource=new Set(['condition_source_value','drug_source_value','procedure_source_value','measurement_source_value','observation_source_value','device_source_value','specimen_source_value','unit_source_value','dose_unit_source_value','route_source_value']);
export const INPUT_TABLES=TABLES.filter(t=>!t.vocabulary&&!forbiddenTables.has(t.name)).map(t=>t.name);
export function parseBundle(value:unknown,scope:string,linkageKey:Buffer,maxRows=5000):CdmBundle {
  const input=object(value);keys(input,['cdm_version','tables']);check(input.cdm_version==='5.4',422,'CDM_VERSION_MISMATCH','Use the pinned OMOP 5.4 contract.');
  const tables=object(input.tables);keys(tables,INPUT_TABLES);let count=0;const out:Record<string,CdmRow[]>={};
  for(const [name,rawRows]of Object.entries(tables)){
    const spec=TABLE_MAP.get(name)!;check(Array.isArray(rawRows),422,'INVALID_BUNDLE','Each table must contain an array.');
    count+=rawRows.length;check(count<=maxRows,422,'WAREHOUSE_BATCH_LIMIT','Split the upload into bounded batches.');
    out[name]=rawRows.map(raw=>{
      const r=object(raw);keys(r,[...spec.columns.map(c=>c.name),'_code_system']);const result:CdmRow={};
      for(const c of spec.columns){let v=r[c.name];
        if(direct.has(c.name)){check(v===undefined||v===null||v==='',422,'DIRECT_OR_FREE_TEXT_FIELD','Do not submit direct identifiers, exact birth dates or free text to the research warehouse.');result[c.name]=null;continue;}
        if(v===undefined||v===null||v===''){result[c.name]=null;continue;}
        if(c.name==='county')check(typeof v==='string'&&/^TZ-(?:0[1-9]|[12][0-9]|3[01])$/.test(v),422,'REGION_REQUIRED','Location is restricted to approved region codes.');
        if(c.name==='state')check(typeof v==='string'&&/^(?:0[1-9]|[12][0-9]|3[01])$/.test(v),422,'REGION_REQUIRED','Use the two-digit region code.');
        if(c.name==='country_source_value')check(v==='TZ',422,'COUNTRY_REQUIRED','Current data source contract uses TZ.');
        if(c.name.endsWith('_source_value')&&!clinicalSource.has(c.name)&&!['country_source_value'].includes(c.name)){result[c.name]=null;continue;}
        if(c.type==='varchar'||c.type==='text'){
          check(typeof v==='string'&&v.length<=(c.length??1000)&&!/[\u0000-\u001f\u007f]/.test(v),422,'INVALID_CDM_STRING','Invalid coded value.');
          if(clinicalSource.has(c.name))check(/^[A-Za-z0-9][A-Za-z0-9._/\[\]{}%+-]{0,49}$/.test(v),422,'INVALID_SOURCE_CODE','Only structured codes may be supplied.');
          result[c.name]=v;continue;
        }
        if(c.type==='date'||c.type==='timestamp'){
          check(typeof v==='string',422,'INVALID_CDM_DATE','Source dates must be explicit ISO values.');
          const pattern=c.type==='date'?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
          const d=new Date(c.type==='date'?v+'T00:00:00Z':v);check(pattern.test(v)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v.slice(0,10)&&d.getUTCFullYear()>=1800,422,'INVALID_CDM_DATE','Use a valid ISO date; do not infer exact dates from age bands or quarters.');result[c.name]=c.type==='timestamp'?d.toISOString():v;continue;
        }
        // Source row/reference IDs are pseudonymized before encryption, never copied into CDM exports.
        const ref=c.references?.[0];const identity=(c.name===spec.primaryKey&&!spec.vocabulary)||!!ref&&ref!=='concept'&&!TABLE_MAP.get(ref)?.vocabulary;
        const polymorphic=['cost_event_id','fact_id_1','fact_id_2','measurement_event_id','observation_event_id','event_id'].includes(c.name);
        if(identity||polymorphic){check((typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(v))||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0),422,'INVALID_SOURCE_ID','Use a source-assigned record identifier.');result[c.name]=keyed(linkageKey,'omop-source-id',scope,String(v));continue;}
        check(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e15&&(c.type!=='integer'||Number.isInteger(v)&&v>=-2147483648&&v<=2147483647),422,'INVALID_CDM_NUMBER','Invalid clinical number or concept identifier.');result[c.name]=v;
      }
      if(r._code_system!==undefined){check(typeof r._code_system==='string'&&/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(r._code_system),422,'INVALID_CODE_SYSTEM','Invalid coding system.');result._code_system=r._code_system;}
      return result;
    });
  }
  check(count>0,422,'EMPTY_BUNDLE','Provide structured rows.');
  check(Buffer.byteLength(JSON.stringify(out))<800000,422,'WAREHOUSE_BATCH_LIMIT','Keep each request below 800 KiB.');
  return {cdm_version:'5.4',tables:out};
}
export function mergeBundles(bundles:CdmBundle[],maxRows:number):Record<string,CdmRow[]> {
  const all:Record<string,CdmRow[]>={},seen=new Map<string,string>();let count=0;
  for(const bundle of bundles)for(const [name,rows]of Object.entries(bundle.tables)){
    check(INPUT_TABLES.includes(name),422,'UNSUPPORTED_TABLE','Unsupported bundle table.');const pk=TABLE_MAP.get(name)!.primaryKey;
    for(const row of rows){const json=JSON.stringify(row),key=pk?name+':'+row[pk]:name+':'+json;
      if(seen.has(key)){check(seen.get(key)===json,409,'SOURCE_ROW_CONFLICT','A source record has conflicting content across batches.');continue;}
      seen.set(key,json);(all[name]??=[]).push({...row});count++;check(count<=maxRows,422,'WAREHOUSE_CAPACITY_LIMIT','Increase reviewed capacity or partition the dataset.');
    }
  }
  return all;
}
