'use strict';
/** Deterministic in-memory dependency double. Not PostgreSQL/Prisma integration. */
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const {createRequire} = require('node:module');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT); let ts;
try { ts = createRequire(path.join(root, 'package.json'))('typescript'); } catch { ts = require('typescript'); }
const copy = x => structuredClone(x);
const NOW = new Date('2031-01-01T05:00:00Z');
const actor = { patient: { sub:'user-a', role:'patient', ppid:'patient-a' }, patientB:{sub:'user-b',role:'patient',ppid:'patient-b'},
 clinician:{sub:'doctor-user',role:'clinician',cpid:'doctor'}, otherDoctor:{sub:'doctor-b-user',role:'clinician',cpid:'doctor-b'},
 admin:{sub:'admin',role:'platform_admin'}, pharmacist:{sub:'pharm',role:'pharmacist'}, guardian:{sub:'guardian',role:'patient'} };
const modelNames = ['user','patientProfile','clinicianProfile','consultationRequest','consultationNote','prescription','prescriptionItem',
 'adherenceLog','medicationReminderPlan','careReminderPreference','careReminder','notificationLog','followUpCycle','checkIn','careContact','careThread','message'];
function seed() {
 const state=Object.fromEntries(modelNames.map(m=>[m,[]]));
 state.user=[{id:'user-a',status:'active',phoneNumber:'+0000000001',preferredLanguage:'sw'}, {id:'user-b',status:'active',phoneNumber:'+0000000002',preferredLanguage:'sw'},
 {id:'doctor-user',status:'active'}, {id:'doctor-b-user',status:'active'}, {id:'guardian',status:'active',phoneNumber:'+0000000003',preferredLanguage:'sw'}];
 state.patientProfile=[{id:'patient-a',fullName:'Synthetic Patient A',userId:'user-a',guardianUserId:null},{id:'patient-b',fullName:'Synthetic Patient B',userId:'user-b',guardianUserId:null}];
 state.clinicianProfile=[{id:'doctor',userId:'doctor-user',verificationStatus:'verified'},{id:'doctor-b',userId:'doctor-b-user',verificationStatus:'verified'}];
 state.consultationRequest=[{id:'consultation',status:'completed',careThreadId:'thread',patientProfileId:'patient-a',assignedClinicianId:'doctor'}];
 state.consultationNote=[{id:'note',consultationId:'consultation',signedAt:NOW,signedByClinicianId:'doctor'}];
 state.careThread=[{id:'thread',patientProfileId:'patient-a',activeFollowUpCycleId:'cycle',primaryClinicianId:'doctor',openConsultationCount:0}];
 state.prescription=[{id:'prescription',careThreadId:'thread',patientProfileId:'patient-a',prescribedById:'doctor',consultationId:'consultation',status:'active',createdAt:NOW}];
 state.prescriptionItem=[{id:'item',prescriptionId:'prescription',medicationName:'TEST-ONLY ITEM',dosage:'TEST-ONLY DOSE',frequencyPerDay:2,durationDays:2,createdAt:NOW}];
 state.followUpCycle=[{id:'cycle',patientProfileId:'patient-a',clinicianId:'doctor',careThreadId:'thread',sourceConsultationId:'consultation',status:'active',
 frequency:'daily',customCron:null,questionnaireKey:null,recoveryCriteria:{red_flag_fields:['test_attention']},startDate:NOW,endDate:new Date('2031-01-04T00:00:00Z'),
 outcome:null,openDeviationCount:0,version:1,updatedAt:NOW}];
 return state;
}
function harness(options={}) {
 let state=Object.assign(seed(),copy(options.state||{})), seq=0, tail=Promise.resolve(), auditFailure=false;
 const locks=[], audits=[], calls=[], sends=[];
 const modelFor=(m)=>state[m]||(state[m]=[]);
 function rel(m,r,k) {
  const one=(model,id)=>({model,value:modelFor(model).find(x=>x.id===id)||null});
  const many=(model,key,value)=>({model,value:modelFor(model).filter(x=>x[key]===value)});
  if(m==='patientProfile') { if(k==='user')return one('user',r.userId);if(k==='guardian')return one('user',r.guardianUserId);if(k==='reminderPreferences')return {model:'careReminderPreference',value:modelFor('careReminderPreference').find(x=>x.patientProfileId===r.id)||null};if(k==='careThreads')return many('careThread','patientProfileId',r.id); }
  if(m==='clinicianProfile'&&k==='user')return one('user',r.userId);
  if(m==='prescriptionItem') { if(k==='adherenceLogs')return many('adherenceLog','prescriptionItemId',r.id); if(k==='prescription')return one('prescription',r.prescriptionId);if(k==='reminderPlan')return {model:'medicationReminderPlan',value:modelFor('medicationReminderPlan').find(x=>x.prescriptionItemId===r.id)||null}; }
  if(m==='prescription'){ if(k==='patient')return one('patientProfile',r.patientProfileId); if(k==='consultation')return one('consultationRequest',r.consultationId);if(k==='items')return many('prescriptionItem','prescriptionId',r.id);if(k==='adherenceLogs')return many('adherenceLog','prescriptionId',r.id); }
  if(m==='consultationRequest'&&k==='note')return {model:'consultationNote',value:modelFor('consultationNote').find(x=>x.consultationId===r.id)||null};
  if(m==='adherenceLog'){ if(k==='patient')return one('patientProfile',r.patientProfileId);if(k==='prescription')return one('prescription',r.prescriptionId);if(k==='reminderPlan')return one('medicationReminderPlan',r.reminderPlanId);if(k==='careReminder')return {model:'careReminder',value:modelFor('careReminder').find(x=>x.adherenceLogId===r.id)||null}; }
  if(m==='medicationReminderPlan'&&k==='item')return one('prescriptionItem',r.prescriptionItemId);
  if(m==='followUpCycle'){ if(k==='patient')return one('patientProfile',r.patientProfileId);if(k==='contacts')return many('careContact','followUpCycleId',r.id);if(k==='checkIns')return many('checkIn','followUpCycleId',r.id); }
  if(m==='checkIn'){ if(k==='followUpCycle')return one('followUpCycle',r.followUpCycleId);if(k==='careReminder')return {model:'careReminder',value:modelFor('careReminder').find(x=>x.checkInId===r.id)||null}; }
  if(m==='careReminder'){ if(k==='patient')return one('patientProfile',r.patientProfileId);if(k==='dose')return one('adherenceLog',r.adherenceLogId);if(k==='checkIn')return one('checkIn',r.checkInId);if(k==='notification')return one('notificationLog',r.notificationId); }
  if(m==='notificationLog'&&k==='user')return one('user',r.userId);
  if(m==='careContact'&&k==='cycle')return one('followUpCycle',r.followUpCycleId);
  return null;
 }
 const eq=(a,b)=>a instanceof Date&&b instanceof Date?a.getTime()===b.getTime():a===b;
 function match(m,r,w={}){ return Object.entries(w).every(([k,v])=>{
  if(v===undefined)return true;
  if(k==='OR')return v.some(x=>match(m,r,x));if(k==='AND')return (Array.isArray(v)?v:[v]).every(x=>match(m,r,x));if(k==='NOT')return !match(m,r,v);
  const relation=rel(m,r,k);
  if(relation){ const {model,value}=relation;
   if(v===null)return value===null;
   if('is' in v)return v.is===null?value===null:!!value&&match(model,value,v.is);
   if('isNot' in v)return v.isNot===null?value!==null:!value||!match(model,value,v.isNot);
   if('some' in v)return value.some(x=>match(model,x,v.some));if('none' in v)return !value.some(x=>match(model,x,v.none));
   return !!value&&match(model,value,v);
  }
  if(!(k in r)&&v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Date)&&Object.keys(v).every(key=>key in r))return match(m,r,v);
  const x=r[k]??null;
  if(v===null||typeof v!=='object'||v instanceof Date)return eq(x,v);
  return Object.entries(v).every(([op,val])=>{
   if(op==='in')return val.includes(x);if(op==='notIn')return !val.includes(x);if(op==='not')return !eq(x,val);if(op==='equals')return eq(x,val);
   if(op==='gte')return x>=val;if(op==='lte')return x<=val;if(op==='gt')return x>val;if(op==='lt')return x<val;
   throw Error('Unsupported filter '+m+'.'+k+'.'+op);
  });
 }); }
 function list(m,args={},input=modelFor(m)){
  let rows=input.filter(r=>match(m,r,args.where));
  const order=Array.isArray(args.orderBy)?args.orderBy:args.orderBy?[args.orderBy]:[];
  rows.sort((a,b)=>{for(const x of order){const[k,d]=Object.entries(x)[0];if(a[k]<b[k])return d==='asc'?-1:1;if(a[k]>b[k])return d==='asc'?1:-1;}return 0;});
  if(args.cursor){const at=rows.findIndex(x=>x.id===args.cursor.id);rows=rows.slice(at<0?rows.length:at+(args.skip||0));}else if(args.skip)rows=rows.slice(args.skip);
  if(args.take!==undefined)rows=rows.slice(0,args.take);
  return rows;
 }
 function project(m,r,args={}){
  if(!r)return null;
  const out=args.select?{}:copy(r);
  for(const[k,v]of Object.entries(args.select||args.include||{})){
   if(!v)continue;
   if(k==='_count'){out._count={};for(const[key,spec]of Object.entries(v.select||{})){const rr=rel(m,r,key);out._count[key]=list(rr.model,spec===true?{}:spec,rr.value).length;}continue;}
   const rr=rel(m,r,k);
   if(rr)out[k]=Array.isArray(rr.value)?list(rr.model,v===true?{}:v,rr.value).map(x=>project(rr.model,x,v===true?{}:v)):project(rr.model,rr.value,v===true?{}:v);
   else out[k]=copy(r[k]);
  }
  return out;
 }
 function defaults(m,data){return {id:`generated-${++seq}`,createdAt:NOW,updatedAt:NOW,version:1,
  ...(m==='adherenceLog'?{reportedStatus:'unreported',reportedAt:null,note:null,channel:null,supersededAt:null,reminderPlanId:null}:{}),
  ...(m==='medicationReminderPlan'?{status:'active',configuredAt:NOW}:{}),
  ...(m==='careReminderPreference'?{smsEnabled:false}:{}),
  ...(m==='careReminder'?{adherenceLogId:null,checkInId:null,notificationId:null,readAt:null}:{}),
  ...(m==='notificationLog'?{status:'queued',attempts:0,claimUntil:null,claimToken:null,deliverAfter:null,providerRef:null,failureCode:null,sentAt:null,payload:{}}:{}),
  ...(m==='checkIn'?{status:'scheduled',questions:[],responses:null,isDeviation:false,deviationReasons:[],reviewedAt:null,reviewedById:null,reviewNote:null,respondedAt:null,channel:null}:{}),
  ...(m==='careContact'?{status:'scheduled',note:null,completedAt:null}:{}),...copy(data)};}
 function unique(m,row){
  const keys=m==='medicationReminderPlan'?['prescriptionItemId']:m==='careReminderPreference'?['patientProfileId']:m==='careReminder'?['adherenceLogId','checkInId','notificationId']:m==='notificationLog'?['dedupeKey']:[];
  for(const key of keys)if(row[key]!=null&&modelFor(m).some(x=>x[key]===row[key]))throw Error('Unique constraint '+key);
  if(m==='careContact'&&modelFor(m).some(x=>x.followUpCycleId===row.followUpCycleId&&x.requestKey===row.requestKey))throw Error('Unique contact');
  if(m==='adherenceLog'&&row.reminderPlanId&&!row.supersededAt&&modelFor(m).some(x=>x.reminderPlanId===row.reminderPlanId&&!x.supersededAt&&eq(x.scheduledAt,row.scheduledAt)))throw Error('Unique slot');
 }
 function patch(r,data){for(const[k,v]of Object.entries(data)){if(v===undefined)continue;r[k]=v&&typeof v==='object'&&'increment'in v?(r[k]||0)+v.increment:v&&typeof v==='object'&&'decrement'in v?(r[k]||0)-v.decrement:copy(v);}r.updatedAt=NOW;}
 function client(){ const db={};for(const m of modelNames) db[m]={
  findMany:async(args={})=>{calls.push({m,op:'findMany',args:copy(args)});return list(m,args).map(r=>project(m,r,args));},
  findFirst:async(args={})=>project(m,list(m,args)[0],args),findFirstOrThrow:async(args={})=>{const r=list(m,args)[0];if(!r)throw Error('Not found');return project(m,r,args);},
  findUnique:async(args)=>project(m,modelFor(m).find(r=>match(m,r,args.where)),args),
  findUniqueOrThrow:async(args)=>{const r=modelFor(m).find(r=>match(m,r,args.where));if(!r)throw Error('Not found');return project(m,r,args);},
  count:async(args={})=>list(m,args).length,
  create:async(args)=>{const row=defaults(m,args.data);unique(m,row);modelFor(m).push(row);return project(m,row,args);},
  createMany:async(args)=>{for(const d of args.data){const row=defaults(m,d);unique(m,row);modelFor(m).push(row);}return {count:args.data.length};},
  update:async(args)=>{const row=modelFor(m).find(r=>match(m,r,args.where));if(!row)throw Error('Not found');patch(row,args.data);return project(m,row,args);},
  updateMany:async(args)=>{let count=0;for(const row of modelFor(m))if(match(m,row,args.where)){patch(row,args.data);count++;}return {count};},
  upsert:async(args)=>{let row=modelFor(m).find(r=>match(m,r,args.where));if(row)patch(row,args.update);else{row=defaults(m,args.create);unique(m,row);modelFor(m).push(row);}return project(m,row,args);},
 };
 db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');locks.push({sql,values});if(sql.includes('follow_up_cycles'))return modelFor('followUpCycle').filter(x=>x.id===values[0]).map(x=>({id:x.id}));return [{locked:1}];};
 db.$transaction=async(fn,options)=>{let release;const previous=tail;tail=new Promise(r=>{release=r;});await previous;const before=copy(state),auditStart=audits.length;
  calls.push({op:'transaction',options});try{return await fn(db);}catch(e){state=before;audits.splice(auditStart);throw e;}finally{release();}};
 return db;}
 const db=client();
 const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:code==='NOT_FOUND'?404:code==='VALIDATION_FAILED'?422:code==='NOT_RESOURCE_OWNER'||code==='ROLE_NOT_PERMITTED'||code==='CLINICIAN_NOT_VERIFIED'?403:409});
 const http={forbidden:fail,conflict:fail,notFound:m=>fail('NOT_FOUND',m),unprocessable:m=>fail('VALIDATION_FAILED',m),cursorArgs:(cursor,limit)=>({take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})}),
  toCursorPage:(rows,limit,mapper)=>({data:rows.slice(0,limit).map(mapper),meta:{has_more:rows.length>limit}}),
  appendAudit:async(event,tx)=>{if(tx!==db)throw Error('Audit must share transaction');if(auditFailure)throw Error('Synthetic audit failure');audits.push(copy(event));}};
 const env={CARE_REMINDER_WINDOW_MINUTES:120,CARE_REMINDER_BATCH:100,CARE_REMINDER_INTERVAL_SECONDS:30,MAX_ATTEMPTS:4,DISPATCH_BATCH_SIZE:50,DISPATCH_LEASE_SECONDS:120,...options.env};
 let sendResult={ok:true,providerRef:'console-synthetic'};
 const dependencies={'@a-health/database':{prisma:db},'@a-health/http':http,'@a-health/logger':{createLogger:()=>({info(){},warn(){},error(){}})}};
 const cache=new Map();
 function load(relative){const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:file});
  new vm.Script(`(function(require,module,exports){${compiled.outputText}\n})`,{filename:file}).runInThisContext()((name)=>{
   if(dependencies[name])return dependencies[name];if(name.startsWith('node:'))return require(name);
   if(name.includes('config/env'))return{env};
   if(name.includes('providers/index'))return{resolveProvider:()=>({name:options.providerName||'console',send:async(to,body,opts)=>{sends.push({to,body,options:opts});return copy(sendResult);}})};
   if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name.replace(/\.js$/,'.ts'))));
   throw Error('Missing dependency '+name);
  },module,module.exports);return module.exports;}
 return {db,load,get state(){return state;},locks,audits,calls,sends,actor,NOW,failAudit:(value=true)=>{auditFailure=value;},setSendResult:v=>{sendResult=v;},create:(m,d)=>db[m].create({data:d})};
}
module.exports={harness,actor,NOW,seed};
