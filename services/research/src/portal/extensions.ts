import { randomUUID } from 'node:crypto';
import type { Actor, BaseRow, Collection, Form, OmopBuild, OutputRequest, PortalConfig, Release, ResponseSnapshot, Rows, SourceGrant, Store, Study, Table, Tx } from './types.js';
import { check, id, integer, keys, object, oneOf, PortalError, seal, sha, text, unseal, keyed } from './policy.js';
import { parseBundle } from '../warehouse/bundle.js';
import { CDM_VERSION, TABLES } from '../warehouse/catalog.js';
import type { CdmBundle, Materialized, WarehousePort, BuildInput } from '../warehouse/types.js';
import { parseBins, responseDataset, responseFingerprint } from '../responses/analytics.js';
import { omopZip, outputTable } from '../responses/export.js';
export interface ExtensionContext {
  row():BaseRow;admin(actor:Actor):void;researcher(actor:Actor):void;
  required<K extends Table>(tx:Tx,t:K,id:unknown):Promise<Rows[K]>;
  matchVersion(row:BaseRow,input:Record<string,unknown>):void;
  update<K extends Table>(tx:Tx,t:K,row:Rows[K],patch:Partial<Rows[K]>):Promise<Rows[K]>;
  sourceLive(tx:Tx,source:SourceGrant):Promise<void>;
  approvedStudy(tx:Tx,actor:Actor,id:unknown):Promise<{study:Study;dataset:Collection;release:Release}>;
  audit(tx:Tx,actor:Actor,action:string,id?:string,metadata?:Record<string,string|number|boolean|null>):Promise<void>;
}
export interface DownloadPlan {request:OutputRequest;stamp:string;snapshot?:ResponseSnapshot;form?:Form;build?:OmopBuild}
export interface DownloadArtifact {planStamp:string;file:ReturnType<typeof outputTable>}
export class ResearchExtensions {
  constructor(private cfg:PortalConfig,private warehouse:WarehousePort|undefined,private clock:()=>Date){}
  private fingerprint(rows:Rows['omopBatch'][],maps:Rows['mapping'][]){return sha(JSON.stringify({batches:rows.map(r=>[r.id,r.payloadHash,r.status]).sort(),mappings:maps.map(m=>[m.id,m.version,m.conceptId,m.vocabularyVersion]).sort()}));}
  private async freshSnapshot(tx:Tx,c:ExtensionContext,s:ResponseSnapshot){
    const form=await c.required(tx,'form',s.formId);check(form.status==='published'&&form.version===s.formVersion,403,'FORM_NOT_AUTHORIZED','Form definition is no longer approved.');
    const rows=await tx.list('response',{formId:form.id},20001);check(rows.length<=20000,422,'RESPONSE_CAPACITY_LIMIT','Partition prospective collection into approved forms.');
    check(responseFingerprint(rows)===s.responseFingerprint,409,'SNAPSHOT_STALE','Responses or consent changed. Prepare and review a new snapshot.');return form;
  }
  private async buildLive(tx:Tx,c:ExtensionContext,b:OmopBuild){
    check(b.status==='published'&&b.warehouseSchema&&b.manifestHash&&b.releaseId,403,'WAREHOUSE_NOT_PUBLISHED','Warehouse build is not currently released.');
    const source=await c.required(tx,'source',b.sourceId);await c.sourceLive(tx,source);
    for(const batchId of b.batchIds){const batch=await c.required(tx,'omopBatch',batchId);check(batch.status==='accepted'&&batch.sourceId===b.sourceId&&batch.datasetId===b.datasetId,403,'WAREHOUSE_BATCH_REVOKED','Underlying warehouse authorization changed.');}
  }
  async downloadPlan(tx:Tx,a:Actor,input:Record<string,unknown>,c:ExtensionContext,review=false):Promise<DownloadPlan>{
    const request=await c.required(tx,'output',input.id);if(review)c.admin(a);else {c.researcher(a);check(request.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Output belongs to another researcher.');}
    const {study,release}=await c.approvedStudy(tx,{sub:request.ownerId,role:'researcher'},request.studyId);
    check(study.allowExport&&request.expiresAt>this.clock(),403,'OUTPUT_NOT_AUTHORIZED','Output permission is inactive or expired.');
    check(review?['pending','approved'].includes(request.status):request.status==='approved',403,'OUTPUT_NOT_AUTHORIZED','Independent output approval is required.');
    if(request.kind==='omop'){
      check(study.allowRowLevel===true,403,'ROW_LEVEL_NOT_AUTHORIZED','Study approval does not include person-level OMOP extracts.');
      const build=await c.required(tx,'omopBuild',request.buildId);await this.buildLive(tx,c,build);
      check(build.datasetId===study.datasetId&&build.releaseId===release.id,403,'RELEASE_SCOPE_MISMATCH','OMOP build must match the project’s exact approved release.');
      return {request,build,stamp:sha(JSON.stringify([request.id,request.version,request.status,build.id,build.version,build.manifestHash,study.version]))};
    }
    const snapshot=await c.required(tx,'responseSnapshot',request.snapshotId);check(snapshot.studyId===study.id&&snapshot.ownerId===request.ownerId&&snapshot.status==='published'&&study.allowEcrf,403,'RESPONSE_RELEASE_NOT_AUTHORIZED','Response snapshot is not approved for this project.');
    const form=await this.freshSnapshot(tx,c,snapshot);
    if(request.kind==='ecrf_rows')check(study.allowRowLevel===true&&snapshot.responseCount>=snapshot.minimumCellSize,403,'ROW_LEVEL_NOT_AUTHORIZED','Row-level access is separately authorized and requires the minimum cohort size.');
    return {request,snapshot,form,stamp:sha(JSON.stringify([request.id,request.version,request.status,snapshot.id,snapshot.version,snapshot.contentHash,study.version]))};
  }
  async artifact(plan:DownloadPlan):Promise<DownloadArtifact>{
    const r=plan.request;
    if(r.kind==='omop'){
      check(this.warehouse&&plan.build?.warehouseSchema&&plan.build.manifestHash,503,'WAREHOUSE_DISABLED','Warehouse is unavailable.');
      const data=await this.warehouse.extract(plan.build.warehouseSchema,plan.build.manifestHash);
      return {planStamp:plan.stamp,file:omopZip(data.tables,data.manifest,r.id)};
    }
    const s=plan.snapshot!,rows=r.kind==='ecrf_rows'?JSON.parse(unseal(s.ciphertext,this.cfg.encryptionKey,'snapshot:'+s.id)) as Record<string,unknown>[]:s.cells as unknown as Record<string,unknown>[];
    const columns=r.kind==='ecrf_rows'?['participant',...plan.form!.fields.map(f=>f.key)]:['field','label','kind','bucket','lower','upper','participants'];
    return {planStamp:plan.stamp,file:outputTable(rows,columns,r.format,{output_id:r.id,snapshot_id:s.id,snapshot_hash:s.contentHash,scope:r.kind,minimum_cell_size:s.minimumCellSize,fee_tzs:0,pseudonymized_not_anonymous:r.kind==='ecrf_rows'})};
  }
  async run(tx:Tx,a:Actor,action:string,input:Record<string,unknown>,c:ExtensionContext,artifact?:DownloadArtifact):Promise<unknown>{
    switch(action){
      case 'extended.bootstrap':{
        keys(input,[]);const admin=a.role==='platform_admin';
        const snapshots=await tx.list('responseSnapshot',admin?{}:{ownerId:a.sub},100);
        const outputs=await tx.list('output',admin?{}:{ownerId:a.sub},100);
        const builds=await tx.list('omopBuild',admin?{}:{status:'published'},100);
        const sources=await tx.list('source',admin?{}:a.role==='facility_admin'?{stewardId:a.sub}:{status:'approved'},100);
        const batches=a.role==='researcher'?[]:(await tx.list('omopBatch',{},1000)).filter(b=>admin||sources.some(s=>s.id===b.sourceId));
        const studies=await tx.list('study',admin?{}:{ownerId:a.sub},100);const forms=await tx.list('form',admin?{}:{ownerId:a.sub},100);
        await c.audit(tx,a,'extended_workspace_opened');
        let warehouseStatus:unknown={enabled:!!this.warehouse,ready:false,cdm_version:CDM_VERSION,table_count:TABLES.length,vocabulary_version:null};
        if(admin||a.role==='facility_admin')try{warehouseStatus=await this.warehouse?.status()??warehouseStatus;}catch{warehouseStatus={enabled:!!this.warehouse,ready:false,cdm_version:CDM_VERSION,table_count:TABLES.length,vocabulary_version:null,error:'Warehouse initialization or licensed vocabulary is required.'};}
        return {role:a.role,user_id:a.sub,warehouse:warehouseStatus,tables:TABLES.map(t=>({name:t.name,columns:t.columns.length,vocabulary:t.vocabulary})),studies,forms,sources:a.role==='researcher'?[]:sources,
          builds:builds.filter(b=>admin||a.role==='facility_admin'&&sources.some(s=>s.id===b.sourceId)||a.role==='researcher'&&studies.some(s=>s.status==='approved'&&s.releaseId===b.releaseId)).map(b=>({id:b.id,version:b.version,datasetId:b.datasetId,sourceId:b.sourceId,status:b.status,datePolicy:b.datePolicy,vocabularyVersion:b.vocabularyVersion,manifestHash:b.manifestHash,releaseId:b.releaseId,...(admin?{quality:b.quality,personCount:b.personCount,errorCode:b.errorCode}:{}),createdAt:b.createdAt})),
          batches:batches.map(({ciphertext,requestKey,...b})=>b),
          snapshots:snapshots.map(({ciphertext,cells,responseCount,suppressedFields,...s})=>({...s,...(admin?{responseCount,suppressedFields}:{}),publishedCells:s.status==='published'?cells.length:0})),outputs,fee_tzs:0};
      }
      case 'warehouse.ingest':{
        keys(input,['source_id','request_key','synthetic','bundle']);const source=await c.required(tx,'source',input.source_id);
        check(a.role==='facility_admin'&&source.stewardId===a.sub,403,'SOURCE_ACCESS_DENIED','Only the named hospital data steward can ingest a warehouse source.');await c.sourceLive(tx,source);
        const dataset=await c.required(tx,'collection',source.datasetId);check(dataset.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');
        check(input.synthetic===dataset.syntheticOnly&&typeof input.synthetic==='boolean',422,'SOURCE_MODE_MISMATCH','Match the source synthetic/real mode.');check(dataset.syntheticOnly||this.cfg.realDataEnabled,403,'REAL_INGEST_DISABLED','Real-data ingestion is disabled.');
        const requestKey=text(input,'request_key',8,120),bundle=parseBundle(input.bundle,dataset.id+':'+source.id,this.cfg.linkageKey);
        const tableDomain:Record<string,string>={condition_occurrence:'condition',condition_era:'condition',drug_exposure:'drug',drug_era:'drug',dose_era:'drug',measurement:'measurement',procedure_occurrence:'procedure',observation:'observation',device_exposure:'observation',specimen:'observation'};
        for(const [table,rows]of Object.entries(bundle.tables))if(rows.length&&tableDomain[table])check(dataset.domains.includes(tableDomain[table])||(table==='measurement'&&dataset.domains.includes('imaging')),403,'DOMAIN_NOT_ALLOWED','Clinical domain is outside the authorized collection.');
        const hash=sha(JSON.stringify(bundle));const old=(await tx.list('omopBatch',{sourceId:source.id,requestKey},1))[0];
        if(old){check(old.payloadHash===hash&&old.status==='accepted',409,'INGEST_VERSION_CONFLICT','Request key already has different or revoked content.');return {id:old.id,status:'accepted',duplicate:true,input_rows:old.inputRows};}
        const row=c.row(),inputRows=Object.values(bundle.tables).reduce((n,rows)=>n+rows.length,0);
        await tx.insert('omopBatch',{...row,datasetId:dataset.id,sourceId:source.id,requestKey,payloadHash:hash,ciphertext:seal(JSON.stringify(bundle),this.cfg.encryptionKey,'omop-batch:'+row.id),inputRows,synthetic:dataset.syntheticOnly,submittedBy:a.sub,status:'accepted'});
        await c.audit(tx,a,'omop_batch_ingested',row.id,{sourceId:source.id,rows:inputRows});return {id:row.id,status:'accepted',duplicate:false,input_rows:inputRows,note:'Encrypted source batch; not yet an OMOP dataset release.'};
      }
      case 'warehouse.batch.revoke':{
        keys(input,['id','base_version']);const batch=await c.required(tx,'omopBatch',input.id);const source=await c.required(tx,'source',batch.sourceId);
        check(a.role==='platform_admin'||a.role==='facility_admin'&&source.stewardId===a.sub,403,'SOURCE_ACCESS_DENIED','Only the source steward or governance administrator can revoke a batch.');c.matchVersion(batch,input);
        const result=await c.update(tx,'omopBatch',batch,{status:'revoked'});
        for(const build of await tx.list('omopBuild',{sourceId:batch.sourceId},20001))if(build.batchIds.includes(batch.id)){
          await c.update(tx,'omopBuild',build,{status:'revoked'});if(build.releaseId){const release=await c.required(tx,'release',build.releaseId);await c.update(tx,'release',release,{status:'revoked'});}
        }
        await c.audit(tx,a,'omop_batch_revoked',batch.id);return {id:result.id,status:result.status};
      }
      case 'warehouse.build':{
        c.admin(a);keys(input,['source_id','date_policy']);check(this.warehouse,503,'WAREHOUSE_DISABLED','Configure the dedicated warehouse first.');
        const status=await this.warehouse.status();check(status.ready,503,'VOCABULARY_REQUIRED','Initialize warehouse and import licensed vocabulary before queuing ETL.');
        const source=await c.required(tx,'source',input.source_id);await c.sourceLive(tx,source);const dataset=await c.required(tx,'collection',source.datasetId);check(dataset.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');check(dataset.syntheticOnly||this.cfg.realDataEnabled,403,'REAL_INGEST_DISABLED','Real-data ETL is disabled.');
        const batches=await tx.list('omopBatch',{sourceId:source.id,status:'accepted'},20001);check(batches.length>0&&batches.length<=20000,422,'BATCH_REQUIRED','Upload bounded structured CDM batches first.');
        const mappings=await tx.list('mapping',{},5000),fingerprint=this.fingerprint(batches,mappings),datePolicy=oneOf(input.date_policy,['restricted_source_dates','shifted_dates'],'date policy');
        const previous=await tx.list('omopBuild',{sourceId:source.id,sourceFingerprint:fingerprint},100);
        const same=previous.find(b=>b.datePolicy===datePolicy&&b.vocabularyVersion===status.vocabulary_version&&['queued','running','pending','published'].includes(b.status));if(same)return {id:same.id,status:same.status,duplicate:true};
        const row=await tx.insert('omopBuild',{...c.row(),datasetId:dataset.id,sourceId:source.id,ownerId:a.sub,batchIds:batches.map(b=>b.id),sourceFingerprint:fingerprint,datePolicy,status:'queued',warehouseSchema:null,vocabularyVersion:status.vocabulary_version,manifestHash:null,quality:{},cells:[],withheldCells:0,personCount:0,releaseId:null,errorCode:null,leaseToken:null,leaseExpiresAt:null,reviewedBy:null,reviewNote:null});
        await c.audit(tx,a,'omop_build_queued',row.id,{batches:batches.length});return {id:row.id,status:row.status,duplicate:false};
      }
      case 'warehouse.inspect':{
        c.admin(a);keys(input,['id']);const build=await c.required(tx,'omopBuild',input.id);await c.audit(tx,a,'omop_build_inspected',build.id);
        const {leaseToken,leaseExpiresAt,...safe}=build;return safe;
      }
      case 'warehouse.review':{
        c.admin(a);keys(input,['id','base_version','decision','mapping_checked','date_policy_checked','disclosure_checked','note']);const build=await c.required(tx,'omopBuild',input.id);c.matchVersion(build,input);
        const decision=oneOf(input.decision,['published','rejected','revoked'],'decision');let releaseId=build.releaseId;
        if(decision==='published'){
          check(build.status==='pending'&&build.ownerId!==a.sub,403,'INDEPENDENT_REVIEW_REQUIRED','Another administrator must review the completed ETL build.');check(build.quality.passed===true&&build.manifestHash&&build.warehouseSchema&&build.cells.length>0,422,'WAREHOUSE_QUALITY_REQUIRED','A validated build with publishable cells is required.');
          check(input.mapping_checked===true&&input.date_policy_checked===true&&input.disclosure_checked===true,422,'DISCLOSURE_REVIEW_REQUIRED','Review vocabulary, date policy, privacy and overlapping releases.');
          const source=await c.required(tx,'source',build.sourceId);await c.sourceLive(tx,source);const dataset=await c.required(tx,'collection',build.datasetId);check(dataset.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');
          for(const batchId of build.batchIds)check((await c.required(tx,'omopBatch',batchId)).status==='accepted',403,'WAREHOUSE_BATCH_REVOKED','A source batch was revoked.');
          const release=await tx.insert('release',{...c.row(),datasetId:dataset.id,status:'published',sourceIds:[build.sourceId],cells:build.cells,quality:{staged_events:0,unmapped_events:0,mapping_coverage:100,withheld_cells:build.withheldCells,transform_version:'omop-5.4-warehouse-v1',warehouse_build_id:build.id},minimumCellSize:dataset.minimumCellSize,contentHash:sha(JSON.stringify(build.cells)),createdBy:build.ownerId,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});
          releaseId=release.id;await c.update(tx,'collection',dataset,{status:'published',latestReleaseId:release.id});
        }else {check(['pending','published'].includes(build.status),409,'STATE_TRANSITION_INVALID','Only a reviewable or published build can be rejected/revoked.');if(build.releaseId){const release=await c.required(tx,'release',build.releaseId);await c.update(tx,'release',release,{status:'revoked'});}}
        const updated=await c.update(tx,'omopBuild',build,{status:decision,releaseId,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await c.audit(tx,a,'omop_build_reviewed',build.id,{decision});return {id:updated.id,version:updated.version,status:updated.status,release_id:releaseId};
      }
      case 'ecrf.responses':{
        c.researcher(a);keys(input,['form_id']);const form=await c.required(tx,'form',input.form_id);const {study}=await c.approvedStudy(tx,a,form.studyId);check(study.allowEcrf,403,'ECRF_NOT_AUTHORIZED','eCRF scope has been revoked.');check(form.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Form belongs to another researcher.');
        const rows=await tx.list('response',{formId:form.id},20001);check(rows.length<=20000,422,'RESPONSE_CAPACITY_LIMIT','Response capacity exceeded.');await c.audit(tx,a,'response_register_read',form.id);
        return {responses:rows.map(r=>({id:r.id,version:r.version,status:r.status??'active',participant_reference:keyed(this.cfg.linkageKey,'ecrf-release-participant',form.studyId,form.id,r.subjectHash).slice(0,32)}))};
      }
      case 'ecrf.withdraw':{
        c.researcher(a);keys(input,['id','base_version','reason']);const response=await c.required(tx,'response',input.id);const form=await c.required(tx,'form',response.formId);check(form.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Response belongs to another researcher.');c.matchVersion(response,input);
        check(response.status!=='withdrawn',409,'ALREADY_WITHDRAWN','Response is already withdrawn.');const reason=oneOf(input.reason,['participant_withdrew','consent_invalid','record_error'],'reason');
        const result=await c.update(tx,'response',response,{status:'withdrawn',withdrawnAt:this.clock(),withdrawalCode:reason});await c.audit(tx,a,'response_withdrawn',response.id,{formId:form.id});return {id:result.id,status:result.status,version:result.version};
      }
      case 'ecrf.prepare':{
        c.researcher(a);keys(input,['form_id','bins']);const form=await c.required(tx,'form',input.form_id);const {study,dataset}=await c.approvedStudy(tx,a,form.studyId);check(study.allowEcrf&&form.status==='published'&&form.ownerId===a.sub,403,'ECRF_NOT_AUTHORIZED','Form analysis is not authorized.');
        const rows=await tx.list('response',{formId:form.id},20001);check(rows.length>0&&rows.length<=20000,422,'RESPONSE_CAPACITY_LIMIT','Collect 1–20,000 responses per reviewed form.');const bins=parseBins(form.fields,input.bins),specHash=sha(JSON.stringify({fields:form.fields,bins}));
        const previous=await tx.list('responseSnapshot',{formId:form.id},20001);check(previous.every(s=>s.specHash===specHash),409,'ANALYSIS_SPEC_IMMUTABLE','Published-form analysis bins cannot be changed. Amend the protocol and create a new form.');
        const fingerprint=responseFingerprint(rows),duplicate=previous.find(s=>s.responseFingerprint===fingerprint&&['pending','published'].includes(s.status));if(duplicate)return {id:duplicate.id,status:duplicate.status,duplicate:true};
        const active=rows.filter(r=>r.status!=='withdrawn'),datasetRows=responseDataset(form.fields,active.map(r=>({subjectHash:r.subjectHash,answers:JSON.parse(unseal(r.ciphertext,this.cfg.encryptionKey,'response:'+r.id))})),bins,dataset.minimumCellSize,this.cfg.linkageKey,study.id,form.id);
        const row=c.row(),contentHash=sha(JSON.stringify({cells:datasetRows.cells,rows:datasetRows.rows,specHash,fingerprint}));
        await tx.insert('responseSnapshot',{...row,formId:form.id,studyId:study.id,ownerId:a.sub,formVersion:form.version,responseFingerprint:fingerprint,specHash,bins,cells:datasetRows.cells,suppressedFields:datasetRows.suppressedFields,responseCount:datasetRows.participantCount,minimumCellSize:dataset.minimumCellSize,ciphertext:seal(JSON.stringify(datasetRows.rows),this.cfg.encryptionKey,'snapshot:'+row.id),contentHash,status:'pending',reviewedBy:null,reviewNote:null});
        await c.audit(tx,a,'response_snapshot_prepared',row.id,{formId:form.id});return {id:row.id,status:'pending',duplicate:false,note:'Independent disclosure review is required before charts or downloads.'};
      }
      case 'ecrf.inspect':{
        c.admin(a);keys(input,['id']);const s=await c.required(tx,'responseSnapshot',input.id);await c.approvedStudy(tx,{sub:s.ownerId,role:'researcher'},s.studyId);await this.freshSnapshot(tx,c,s);await c.audit(tx,a,'response_snapshot_inspected',s.id);const {ciphertext,...safe}=s;return safe;
      }
      case 'ecrf.review':{
        c.admin(a);keys(input,['id','base_version','decision','disclosure_checked','protocol_checked','note']);const s=await c.required(tx,'responseSnapshot',input.id);c.matchVersion(s,input);const decision=oneOf(input.decision,['published','rejected','revoked'],'decision');
        check(s.ownerId!==a.sub,403,'SELF_APPROVAL_FORBIDDEN','Independent review required.');
        if(decision==='published'){check(s.status==='pending',409,'STATE_TRANSITION_INVALID','Snapshot is not pending review.');await c.approvedStudy(tx,{sub:s.ownerId,role:'researcher'},s.studyId);await this.freshSnapshot(tx,c,s);check(input.disclosure_checked===true&&input.protocol_checked===true&&s.responseCount>=s.minimumCellSize&&s.cells.length>0,422,'DISCLOSURE_REVIEW_REQUIRED','Review fixed bins, consent, small/complementary cells and overlapping releases.');}
        else check(['pending','published'].includes(s.status),409,'STATE_TRANSITION_INVALID','Snapshot cannot transition from its current status.');
        const updated=await c.update(tx,'responseSnapshot',s,{status:decision,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await c.audit(tx,a,'response_snapshot_reviewed',s.id,{decision});return {id:updated.id,status:updated.status,version:updated.version};
      }
      case 'ecrf.analytics':{
        c.researcher(a);keys(input,['id']);const s=await c.required(tx,'responseSnapshot',input.id);const {study}=await c.approvedStudy(tx,a,s.studyId);check(s.ownerId===a.sub&&s.status==='published'&&study.allowEcrf,403,'RESPONSE_RELEASE_NOT_AUTHORIZED','Approved response release required.');await this.freshSnapshot(tx,c,s);await c.audit(tx,a,'response_analytics_read',s.id);
        return {id:s.id,content_hash:s.contentHash,minimum_cell_size:s.minimumCellSize,cells:s.cells,notice:'Fixed reviewed distributions. A whole field is withheld when any observed category is below the threshold; no hidden totals, minima, maxima or raw responses.',fee_tzs:0};
      }
      case 'output.request':{
        c.researcher(a);keys(input,['study_id','kind','snapshot_id','build_id','format']);const {study,release}=await c.approvedStudy(tx,a,input.study_id);check(study.allowExport,403,'EXPORT_NOT_AUTHORIZED','Project does not authorize downloads.');
        const kind=oneOf(input.kind,['ecrf_aggregate','ecrf_rows','omop'],'output kind'),format=oneOf(input.format,kind==='omop'?['omop_zip']:['csv','xlsx','json','xml'],'format');let snapshotId:string|null=null,buildId:string|null=null;
        check(kind==='ecrf_aggregate'||study.allowRowLevel===true,403,'ROW_LEVEL_NOT_AUTHORIZED','Person-level outputs require separately approved protocol scope.');
        if(kind==='omop'){check(input.snapshot_id===undefined,422,'INVALID_INPUT','OMOP output cannot reference an eCRF snapshot.');const b=await c.required(tx,'omopBuild',input.build_id);await this.buildLive(tx,c,b);check(b.datasetId===study.datasetId&&b.releaseId===release.id,403,'RELEASE_SCOPE_MISMATCH','Study must authorize this exact warehouse release.');buildId=b.id;}
        else {check(input.build_id===undefined,422,'INVALID_INPUT','eCRF output cannot reference an OMOP build.');const s=await c.required(tx,'responseSnapshot',input.snapshot_id);check(s.ownerId===a.sub&&s.studyId===study.id&&s.status==='published'&&study.allowEcrf,403,'RESPONSE_RELEASE_NOT_AUTHORIZED','Approved response snapshot required.');await this.freshSnapshot(tx,c,s);snapshotId=s.id;}
        check((await tx.list('output',{ownerId:a.sub,status:'pending'},21)).length<20,429,'OUTPUT_LIMIT','Review pending requests before adding more.');
        const row=await tx.insert('output',{...c.row(),studyId:study.id,ownerId:a.sub,kind,snapshotId,buildId,format,status:'pending',reviewedBy:null,reviewNote:null,expiresAt:new Date(Math.min(study.expiresAt.getTime(),this.clock().getTime()+7*86400000))});await c.audit(tx,a,'output_requested',row.id,{kind,format});return row;
      }
      case 'output.inspect':{
        c.admin(a);keys(input,['id']);const plan=await this.downloadPlan(tx,a,input,c,true);await c.audit(tx,a,'output_inspected',plan.request.id);
        if(plan.build)return {request:plan.request,quality:plan.build.quality,table_counts:plan.build.quality.table_counts,date_policy:plan.build.datePolicy,note:'Row-level OMOP extract; verify protocol, privacy and date-policy scope. No raw clinical rows are shown here.'};
        const s=plan.snapshot!;return {request:plan.request,columns:plan.request.kind==='ecrf_rows'?['participant',...plan.form!.fields.map(f=>f.key)]:['field','bucket','participants'],cells:s.cells,minimum_cell_size:s.minimumCellSize,row_level:plan.request.kind==='ecrf_rows',note:'Inspect the form schema and published aggregate release; row-level output requires a separate signed protocol scope.'};
      }
      case 'output.review':{
        c.admin(a);keys(input,['id','base_version','decision','output_checked','row_level_checked','note']);const request=await c.required(tx,'output',input.id);c.matchVersion(request,input);const decision=oneOf(input.decision,['approved','rejected','revoked'],'decision');check(request.ownerId!==a.sub&&(decision==='revoked'?request.status==='approved':request.status==='pending'),403,'INDEPENDENT_REVIEW_REQUIRED','Independent review and a valid state transition are required.');
        if(decision==='approved'){await this.downloadPlan(tx,a,input,c,true);check(input.output_checked===true&&(request.kind==='ecrf_aggregate'||input.row_level_checked===true),422,'OUTPUT_REVIEW_REQUIRED','Review the exact output and explicit row-level scope where requested.');}
        const row=await c.update(tx,'output',request,{status:decision,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await c.audit(tx,a,'output_reviewed',row.id,{decision});return row;
      }
      case 'output.download':{
        keys(input,['id']);const plan=await this.downloadPlan(tx,a,input,c);check(artifact&&artifact.planStamp===plan.stamp,409,'OUTPUT_CHANGED','Authorization changed while the file was being prepared.');await c.audit(tx,a,'output_downloaded',plan.request.id,{kind:plan.request.kind,format:plan.request.format});return artifact.file;
      }
      default:throw new PortalError(404,'NOT_FOUND','Research extension operation not found.');
    }
  }
  /** Durable queued job; external warehouse transaction finishes before governance publication.
   * A crash after materialization is safe: retry uses the same build ID + immutable fingerprint. */
  async processNext(store:Store,c:ExtensionContext):Promise<{id:string;status:string}|null>{
    if(!this.warehouse||!this.cfg.enabled)return null;
    const lease=await store.transaction(async tx=>{
      const jobs=await tx.list('omopBuild',{},1000);const job=jobs.find(b=>b.status==='queued'||b.status==='running'&&!!b.leaseExpiresAt&&b.leaseExpiresAt<this.clock());if(!job)return null;
      try{
      const owner=await tx.user(job.ownerId);check(owner?.role==='platform_admin'&&owner.status==='active',403,'ETL_OWNER_INACTIVE','ETL job owner is no longer authorized.');
      const source=await c.required(tx,'source',job.sourceId);await c.sourceLive(tx,source);const dataset=await c.required(tx,'collection',job.datasetId);check(dataset.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');check(dataset.syntheticOnly||this.cfg.realDataEnabled,403,'REAL_INGEST_DISABLED','Real ETL disabled.');
      const batches=await Promise.all(job.batchIds.map(b=>c.required(tx,'omopBatch',b)));check(batches.every(b=>b.status==='accepted'&&b.sourceId===source.id),403,'WAREHOUSE_BATCH_REVOKED','Source batch is not authorized.');const mappings=await tx.list('mapping',{},5000);check(this.fingerprint(batches,mappings)===job.sourceFingerprint,409,'BUILD_INPUT_CHANGED','Reviewed input or mappings changed. Queue a new build.');
      const token=randomUUID(),updated=await c.update(tx,'omopBuild',job,{status:'running',leaseToken:token,leaseExpiresAt:new Date(this.clock().getTime()+15*60000),errorCode:null});
      await c.audit(tx,{sub:job.ownerId,role:'platform_admin'},'omop_build_started',job.id);
      const input:BuildInput={buildId:job.id,sourceId:source.id,datasetId:dataset.id,synthetic:dataset.syntheticOnly,bundles:batches.map(b=>JSON.parse(unseal(b.ciphertext,this.cfg.encryptionKey,'omop-batch:'+b.id)) as CdmBundle),mappings,sourceHash:job.sourceFingerprint,minimumCellSize:dataset.minimumCellSize,linkageKey:this.cfg.linkageKey,datePolicy:job.datePolicy};
      return {job:updated,input,token};
      }catch(e){const code=e instanceof PortalError?e.code:'WAREHOUSE_INPUT_REJECTED';await c.update(tx,'omopBuild',job,{status:'failed',errorCode:code,leaseToken:null,leaseExpiresAt:null});await c.audit(tx,{sub:job.ownerId,role:'platform_admin'},'omop_build_failed',job.id,{code});return {failedId:job.id};}
    });
    if(!lease)return null;
    if('failedId' in lease)return {id:lease.failedId!,status:'failed'};
    try{
      const status=await this.warehouse.status();check(status.vocabulary_version===lease.job.vocabularyVersion,409,'VOCABULARY_CHANGED','Vocabulary changed after queuing; prepare a new job.');const result=await this.warehouse.materialize(lease.input);
      await store.transaction(async tx=>{
        const job=await c.required(tx,'omopBuild',lease.job.id);check(job.status==='running'&&job.leaseToken===lease.token,409,'ETL_LEASE_LOST','ETL lease no longer belongs to this worker.');
        await c.sourceLive(tx,await c.required(tx,'source',job.sourceId));const collection=await c.required(tx,'collection',job.datasetId);check(collection.status!=='suspended',403,'DATASET_SUSPENDED','Dataset suspended during ETL.');const owner=await tx.user(job.ownerId);check(owner?.status==='active'&&owner.role==='platform_admin',403,'ETL_OWNER_INACTIVE','Job owner inactive.');
        const batches=await Promise.all(job.batchIds.map(id=>c.required(tx,'omopBatch',id)));check(batches.every(b=>b.status==='accepted'&&b.sourceId===job.sourceId),403,'WAREHOUSE_BATCH_REVOKED','Source batch revoked during build.');
        check(this.fingerprint(batches,await tx.list('mapping',{},5000))===job.sourceFingerprint,409,'BUILD_INPUT_CHANGED','Mappings or source changed during ETL. Queue a new build.');
        await c.update(tx,'omopBuild',job,{status:'pending',warehouseSchema:result.schema,vocabularyVersion:result.vocabularyVersion,manifestHash:result.manifestHash,quality:result.quality as unknown as Record<string,unknown>,cells:result.cells,withheldCells:result.withheld,personCount:result.persons,leaseToken:null,leaseExpiresAt:null});await c.audit(tx,{sub:job.ownerId,role:'platform_admin'},'omop_build_completed',job.id,{schemaVersion:CDM_VERSION});
      });return {id:lease.job.id,status:'pending'};
    }catch(e){const code=e instanceof PortalError?e.code:'WAREHOUSE_BUILD_FAILED';
      const q=e instanceof PortalError&&e.code==='WAREHOUSE_QUALITY_FAILED'&&'qualityReport' in e?(e as PortalError&{qualityReport:Record<string,unknown>}).qualityReport:undefined;
      await store.transaction(async tx=>{const job=await c.required(tx,'omopBuild',lease.job.id);if(job.leaseToken!==lease.token||job.status!=='running')return;await c.update(tx,'omopBuild',job,{status:'failed',errorCode:code,leaseToken:null,leaseExpiresAt:null,...(q?{quality:q}:{})});await c.audit(tx,{sub:job.ownerId,role:'platform_admin'},'omop_build_failed',job.id,{code});});return {id:lease.job.id,status:'failed'};
    }
  }
}
