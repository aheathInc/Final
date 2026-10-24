'use strict';
const {randomBytes,randomUUID}=require('node:crypto');
const {load}=require('../research-portal/load.cjs');
const {base,ready,verified,pdf}=require('../research-portal/fixture.cjs');
const {ResearchPortal}=load('services/research/src/portal/service.ts');
const {TABLES}=load('services/research/src/warehouse/catalog.ts');
const {parseBundle}=load('services/research/src/warehouse/bundle.ts');
const {mappingKeys,planTables,quality,aggregateTables}=load('services/research/src/warehouse/etl.ts');
const {sha}=load('services/research/src/portal/policy.ts');
function vocabulary(){
 const concepts=new Map();
 function add(id,domain,cls,code,standard='S'){concepts.set(id,{concept_id:id,concept_name:'Synthetic '+domain+' '+code,domain_id:domain,vocabulary_id:id===900000010?'CDM':id===0?'None':'AHP_TEST',concept_class_id:cls,standard_concept:standard,concept_code:code,valid_start_date:'1970-01-01',valid_end_date:'2099-12-31',invalid_reason:null});}
 add(0,'Metadata','Undefined','No matching concept',null);add(8532,'Gender','Gender','F');add(8507,'Gender','Gender','M');add(900000010,'Metadata','CDM','5.4',null);
 add(1000000001,'Condition','Clinical Finding','TEST_COMMON');add(1000000002,'Condition','Clinical Finding','TEST_RARE');
 add(1000000020,'Visit','Visit','TEST_VISIT');add(1000000030,'Drug','Clinical Drug','TEST_DRUG');add(1000000031,'Drug','Ingredient','TEST_INGREDIENT');add(1000000040,'Measurement','Lab Test','TEST_LAB');add(1000000041,'Unit','Unit','mmol/L');
 add(1000000050,'Procedure','Procedure','TEST_PROC');add(1000000060,'Observation','Observation','TEST_OBS');add(1000000070,'Device','Device','TEST_DEVICE');add(1000000080,'Specimen','Specimen','TEST_SPEC');
 return {id:'synthetic-fixture',version:'SYNTHETIC-TEST-ONLY',schema:'ahp_vocab_'+'b'.repeat(32),synthetic:true,hash:'b'.repeat(64),concepts,ancestors:[{ancestor_concept_id:1000000031,descendant_concept_id:1000000030}],domains:new Map()};
}
function rawBundle(n=20){
 const tables={person:[],observation_period:[],visit_occurrence:[],condition_occurrence:[],drug_exposure:[],measurement:[],procedure_occurrence:[],observation:[],device_exposure:[],specimen:[],location:[{location_id:'REGION_03',state:'03',county:'TZ-03',country_source_value:'TZ',country_concept_id:0}],provider:[{provider_id:'PRACTITIONER_TEST',specialty_concept_id:0,gender_concept_id:0}],care_site:[]};
 for(let i=1;i<=n;i++){
 const p='SYNTHETIC_PERSON_'+i,visit='VISIT_'+i;
 tables.person.push({person_id:p,gender_concept_id:8532,year_of_birth:1988,race_concept_id:0,ethnicity_concept_id:0,location_id:'REGION_03',provider_id:'PRACTITIONER_TEST'});
 tables.observation_period.push({observation_period_id:'OBS_PERIOD_'+i,person_id:p,observation_period_start_date:'2024-01-01',observation_period_end_date:'2024-12-31',period_type_concept_id:0});
 tables.visit_occurrence.push({visit_occurrence_id:visit,person_id:p,visit_concept_id:1000000020,visit_start_date:'2024-04-15',visit_end_date:'2024-04-15',visit_type_concept_id:0,provider_id:'PRACTITIONER_TEST'});
 tables.condition_occurrence.push({condition_occurrence_id:'COND_'+i,person_id:p,condition_concept_id:1000000001,condition_start_date:'2024-04-15',condition_start_datetime:'2024-04-15T07:00:00Z',condition_type_concept_id:0,condition_status_concept_id:0,visit_occurrence_id:visit,condition_source_value:'TEST_COMMON'});
 tables.drug_exposure.push({drug_exposure_id:'DRUG_'+i,person_id:p,drug_concept_id:1000000030,drug_exposure_start_date:'2024-04-15',drug_exposure_end_date:'2024-04-20',drug_type_concept_id:0,quantity:6,visit_occurrence_id:visit});
 tables.measurement.push({measurement_id:'LAB_'+i,person_id:p,measurement_concept_id:1000000040,measurement_date:'2024-04-15',measurement_type_concept_id:0,value_as_number:5.2,unit_concept_id:1000000041,range_low:3,range_high:7,visit_occurrence_id:visit});
 tables.procedure_occurrence.push({procedure_occurrence_id:'PROC_'+i,person_id:p,procedure_concept_id:1000000050,procedure_date:'2024-04-15',procedure_type_concept_id:0,visit_occurrence_id:visit});
 tables.observation.push({observation_id:'CLIN_OBS_'+i,person_id:p,observation_concept_id:1000000060,observation_date:'2024-04-15',observation_type_concept_id:0,value_as_concept_id:0,visit_occurrence_id:visit});
 tables.device_exposure.push({device_exposure_id:'DEVICE_'+i,person_id:p,device_concept_id:1000000070,device_exposure_start_date:'2024-04-15',device_type_concept_id:0,visit_occurrence_id:visit});
 tables.specimen.push({specimen_id:'SPEC_'+i,person_id:p,specimen_concept_id:1000000080,specimen_type_concept_id:0,specimen_date:'2024-04-15'});
 }
 return {cdm_version:'5.4',tables};
}
function buildInput(raw=rawBundle(),datePolicy='restricted_source_dates'){
 const key=Buffer.alloc(32,7),sourceId=randomUUID(),datasetId=randomUUID();
 return {buildId:randomUUID(),sourceId,datasetId,synthetic:true,bundles:[parseBundle(raw,datasetId+':'+sourceId,key)],mappings:[],sourceHash:sha('test'),minimumCellSize:10,linkageKey:key,datePolicy};
}
function plan(input,v=vocabulary()){
 const rows=load('services/research/src/warehouse/bundle.ts').mergeBundles(input.bundles,50000);
 const ids=new Map(mappingKeys(rows,v).map((key,i)=>[key,i+1]));return planTables(input,v,ids,50000);
}
class MemoryWarehouse {
 constructor(){this.results=new Map();this.closed=false;this.beforeMaterialize=null;this.beforeExtract=null;this.ready=true;this.version='SYNTHETIC-TEST-ONLY';}
 async status(){return {enabled:true,ready:this.ready,cdm_version:'5.4',table_count:39,vocabulary_version:this.version,synthetic:true};}
 async materialize(input){if(this.beforeMaterialize)await this.beforeMaterialize();if(this.results.has(input.buildId))return this.results.get(input.buildId).result;
 const v=vocabulary(),tables=plan(input,v),dq=quality(tables,v),agg=aggregateTables(tables,v,input.minimumCellSize);if(!dq.passed)throw Error(JSON.stringify(dq.issues));
 const result={schema:'ahp_omop_'+input.buildId.replaceAll('-',''),vocabularyId:v.id,vocabularyVersion:v.version,sourceHash:input.sourceHash,manifestHash:sha(JSON.stringify(tables)),quality:dq,cells:agg.cells,withheld:agg.withheld,persons:tables.person.length,createdAt:new Date().toISOString()};this.results.set(input.buildId,{result,tables});return result;}
 async extract(schema,hash){if(this.beforeExtract)await this.beforeExtract();const x=[...this.results.values()].find(x=>x.result.schema===schema);if(!x||x.result.manifestHash!==hash)throw Error('mismatch');return {tables:x.tables,manifest:x.result};}
}
async function formReady(rowLevel=false,n=20){
 const f=await ready();const {portal:p,actors:a}=f;
 if(rowLevel)f.store.tables.study.get(f.study.id).allowRowLevel=true;
 const fields=[{key:'wellbeing',label:'Wellbeing score',type:'number',required:true,min:0,max:100},{key:'followed_plan',label:'Care plan followed',type:'boolean',required:true},{key:'group_code',label:'Study group',type:'choice',required:true,choices:['A','B']}];
 let form=await p.run(a.researcher,'form.create',{study_id:f.study.id,title:'Synthetic participant survey',fields});
 form=await p.run(a.admin,'form.review',{id:form.id,base_version:form.version,decision:'published',protocol_checked:true});
 for(let i=0;i<n;i++)await p.run(a.researcher,'form.respond',{form_id:form.id,subject_code:'SUBJECT_'+i,consent_reference:'CONSENT_TEST_'+i,consent_confirmed:true,answers:{wellbeing:i<n/2?10:80,followed_plan:i<n/2,group_code:i<n/2?'A':'B'}});
 return {...f,form,fields};
}
async function publishResponses(f){const p=f.portal,a=f.actors;let snapshot=await p.run(a.researcher,'ecrf.prepare',{form_id:f.form.id});snapshot=await p.run(a.admin,'ecrf.review',{id:snapshot.id,base_version:1,decision:'published',disclosure_checked:true,protocol_checked:true,note:'Synthetic independent disclosure review'});return f.store.tables.responseSnapshot.get(snapshot.id);}
async function warehouseReady(){
 const f=base(),w=new MemoryWarehouse();f.warehouse=w;f.portal=new ResearchPortal(f.store,f.config,async()=> 'clean',()=>new Date('2026-10-23T00:00:00Z'),w);
 const p=f.portal,a=f.actors;
 f.dataset=await p.run(a.admin,'collection.create',{name:'OMOP Synthetic',description:'Structured source solely for controlled testing.',domains:['condition','measurement','drug','procedure','observation'],minimum_cell_size:10,synthetic_only:true});
 let source=await p.run(a.admin,'source.create',{dataset_id:f.dataset.id,facility_id:f.facility,steward_id:a.hospital.sub,agreement_reference:'TEST-OMOP-AGREEMENT',expires_at:'2027-07-01T00:00:00Z'});
 await p.run(a.hospital,'evidence.upload',{source_id:source.id,kind:'agreement',content_base64:pdf});f.source=await p.run(a.reviewer,'source.review',{id:source.id,base_version:1,decision:'approved',agreement_checked:true});
 return f;
}
module.exports={load,base,ready,verified,pdf,TABLES,vocabulary,rawBundle,buildInput,plan,MemoryWarehouse,formReady,publishResponses,warehouseReady};
