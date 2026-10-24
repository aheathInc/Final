'use strict';
const {randomBytes,randomUUID}=require('node:crypto');const {load}=require('./load.cjs');
const {ResearchPortal}=load('services/research/src/portal/service.ts');
class MemoryStore {
 constructor(){this.tables=Object.fromEntries(['application','study','evidence','collection','source','event','release','export','form','response','key','mapping','throttle','omopBatch','omopBuild','responseSnapshot','output'].map(x=>[x,new Map()]));this.users=new Map();this.facilities=new Map();this.audits=[];this.queue=Promise.resolve();this.failAudit=false;}
 transaction(fn){const job=this.queue.then(async()=>{const before=structuredClone({tables:this.tables,audits:this.audits});const tx={
 get:async(t,id)=>structuredClone(this.tables[t].get(id)??null),
 list:async(t,f={},n=100)=>Array.from(this.tables[t].values()).filter(r=>Object.entries(f).every(([k,v])=>r[k]===v)).slice(0,n).map(r=>structuredClone(r)),
 insert:async(t,r)=>{if(this.tables[t].has(r.id))throw Error('duplicate');this.tables[t].set(r.id,structuredClone(r));return structuredClone(r);},
 patch:async(t,id,v)=>{const r=this.tables[t].get(id);if(!r)throw Error('not found');Object.assign(r,structuredClone(v));return structuredClone(r);},
 user:async id=>structuredClone(this.users.get(id)??null),facility:async id=>structuredClone(this.facilities.get(id)??null),
 audit:async e=>{if(this.failAudit)throw Error('simulated audit failure');this.audits.push(structuredClone(e));},
 };try{return await fn(tx);}catch(e){this.tables=before.tables;this.audits=before.audits;throw e;}});this.queue=job.catch(()=>{});return job;}
}
const pdf=Buffer.from('%PDF-1.4\nunit-test placeholder, not evidence\n%%EOF').toString('base64');
function base(){
 const store=new MemoryStore();const actors={};for(const [name,role] of Object.entries({admin:'platform_admin',reviewer:'platform_admin',researcher:'researcher',stranger:'researcher',hospital:'facility_admin',patient:'patient'})){const sub=randomUUID();actors[name]={sub,role};store.users.set(sub,{id:sub,role,status:'active'});}
 const facility=randomUUID();store.facilities.set(facility,{id:facility,isActive:true});let now=new Date('2026-10-23T00:00:00Z');
 const config={enabled:true,realDataEnabled:false,encryptionKey:randomBytes(32),linkageKey:randomBytes(32)};
 const portal=new ResearchPortal(store,config,async()=> 'clean',()=>now);return {store,actors,facility,config,portal,advance:ms=>now=new Date(now.getTime()+ms)};
}
async function verified(f,actor=f.actors.researcher){const app=await f.portal.run(actor,'profile.submit',{kind:'independent',display_name:'Synthetic researcher',credential_reference:'TEST-CREDENTIAL'});await f.portal.run(actor,'evidence.upload',{kind:'identity',content_base64:pdf});return f.portal.run(f.actors.admin,'profile.review',{id:app.id,base_version:app.version,decision:'verified',note:'Synthetic verification for tests only',identity_checked:true});}
async function released(f){
 const {portal:p,actors:a}=f;
 const dataset=await p.run(a.admin,'collection.create',{name:'Synthetic conditions '+randomUUID().slice(0,5),description:'Synthetic testing data, not clinical information.',domains:['condition'],minimum_cell_size:10,synthetic_only:true});
 let source=await p.run(a.admin,'source.create',{dataset_id:dataset.id,facility_id:f.facility,steward_id:a.hospital.sub,agreement_reference:'TEST-AGREEMENT',expires_at:'2027-07-01T00:00:00Z'});
 await p.run(a.hospital,'evidence.upload',{source_id:source.id,kind:'agreement',content_base64:pdf});source=await p.run(a.reviewer,'source.review',{id:source.id,base_version:1,decision:'approved',agreement_checked:true});
 for(const [code,concept] of [['TEST_COMMON',1000000001],['TEST_RARE',1000000002]])await p.run(a.admin,'mapping.create',{system:'LOCAL',source_code:code,domain:'condition',concept_id:concept,vocabulary_version:'SYNTHETIC-TEST-ONLY',label:code==='TEST_COMMON'?'Synthetic common condition':'Synthetic rare condition',standard_concept:true,mapping_checked:true});
 const records=Array.from({length:12},(_,i)=>({event_id:'EVENT_'+i,subject_key:'PERSON_'+i,age:35,sex:'female',region_code:'TZ-03',event_date:'2024-04-15',domain:'condition',code_system:'LOCAL',code:'TEST_COMMON',name:'SECRET_PATIENT',phone:'+15550001234',national_id:'SECRET_ID',address:'SECRET_STREET'}));
 const batch=records.concat([0,1,2].map(i=>({...records[i],event_id:'RARE_'+i,code:'TEST_RARE'})),[{...records[0],event_id:'UNMAPPED',code:'UNMAPPED'}]);
 await p.run(a.hospital,'ingest',{source_id:source.id,synthetic:true,records:batch});
 let release=await p.run(a.admin,'release.prepare',{dataset_id:dataset.id});release=await p.run(a.reviewer,'release.review',{id:release.id,base_version:1,decision:'published',note:'Synthetic independent disclosure check',disclosure_checked:true,provenance_checked:true});return {dataset,source,release,records};
}
async function study(f,dataset,approve=true){const p=f.portal,a=f.actors;await verified(f);
 let s=await p.run(a.researcher,'study.create',{title:'Synthetic approved study',purpose:'Study question and purpose using synthetic records only.',dataset_id:dataset.id,ethics_reference:'TEST-ETHICS',ethics_expires_at:'2027-07-01T00:00:00Z',controller_reference:'TEST-CONTROLLER',expires_at:'2027-06-01T00:00:00Z',allow_export:true,allow_ecrf:true});
 for(const kind of ['protocol','ethics','controller'])await p.run(a.researcher,'evidence.upload',{study_id:s.id,kind,content_base64:pdf});
 s=await p.run(a.researcher,'study.submit',{id:s.id,base_version:s.version});if(approve)s=await p.run(a.admin,'study.review',{id:s.id,base_version:s.version,decision:'approved',note:'Synthetic external references checked',ethics_checked:true,controller_checked:true,scope_checked:true});return s;
}
async function ready(){const f=base();Object.assign(f,await released(f));f.study=await study(f,f.dataset);return f;}
module.exports={MemoryStore,pdf,base,verified,released,study,ready};
