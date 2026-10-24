import { randomBytes, randomUUID } from 'node:crypto';
import type { Actor, BaseRow, Collection, Evidence, Form, PortalConfig, Rows, SourceGrant, Store, Study, Table, Tx } from './types.js';
import { check, DOMAINS, filterCells, id, instant, integer, keyed, keys, makeRelease, object, omopReadiness, oneOf, optionalText, parseFields, parseFilters, PortalError, safePdf, seal, sha, SYSTEMS, text, transformEvent, unseal, validateAnswers } from './policy.js';
import { formatExport } from './export.js';
import { ResearchExtensions, type ExtensionContext, type DownloadArtifact } from './extensions.js';
import type { WarehousePort } from '../warehouse/types.js';

export type Scan = (data: Buffer) => Promise<'clean'>;
export class ResearchPortal {
  private extensions:ResearchExtensions;
  constructor(private store: Store, private config: PortalConfig, private scan: Scan, private clock=()=>new Date(), warehouse?:WarehousePort) { this.extensions=new ResearchExtensions(config,warehouse,clock); }
  private context():ExtensionContext { return {row:()=>this.row(),admin:a=>this.admin(a),researcher:a=>this.researcher(a),required:(tx,t,id)=>this.required(tx,t,id),matchVersion:(r,i)=>this.matchVersion(r,i),update:(tx,t,r,p)=>this.update(tx,t,r,p),sourceLive:(tx,s)=>this.sourceLive(tx,s),approvedStudy:(tx,a,id)=>this.approvedStudy(tx,a,id),audit:(tx,a,act,id,m)=>this.audit(tx,a,act,id,m)}; }
  async processWarehouseJob(){return this.extensions.processNext(this.store,this.context());}
  private row():BaseRow { const now=this.clock();return {id:randomUUID(),version:1,createdAt:now,updatedAt:now}; }
  private admin(a:Actor) { check(a.role==='platform_admin',403,'ROLE_NOT_PERMITTED','Research governance administrator required.'); }
  private researcher(a:Actor) {check(a.role==='researcher',403,'ROLE_NOT_PERMITTED','A researcher account is required.');}
  private async verified(tx:Tx,userId:string) {
    const u=await tx.user(userId);check(u?.role==='researcher'&&u.status==='active',403,'RESEARCHER_INACTIVE','Researcher account is not active.');
    const p=(await tx.list('application',{userId},1))[0];check(p?.status==='verified',403,'IDENTITY_REVIEW_REQUIRED','Complete researcher verification first.');return p;
  }
  private async required<K extends Table>(tx:Tx,t:K,value:unknown):Promise<Rows[K]> {const r=await tx.get(t,id(value));check(r,404,'NOT_FOUND','Research resource not found.');return r;}
  private matchVersion(row:BaseRow,input:Record<string,unknown>){check(integer(input.base_version,1,2e9,'base_version')===row.version,409,'VERSION_CONFLICT','This record changed. Refresh before retrying.');}
  private async update<K extends Table>(tx:Tx,t:K,row:Rows[K],patch:Partial<Rows[K]>) {return tx.patch(t,row.id,{...patch,version:row.version+1,updatedAt:this.clock()} as Partial<Rows[K]>);}
  private async audit(tx:Tx,a:Actor,action:string,rowId?:string,metadata:Record<string,string|number|boolean|null>={}) {
    await tx.audit({actorUserId:a.sub,action:`research.portal.${action}`,entityType:'research_portal',entityId:rowId,metadata});
  }
  private async sourceLive(tx:Tx,source:SourceGrant){
    check(source.status==='approved'&&source.expiresAt>this.clock(),403,'SOURCE_NOT_AUTHORIZED','The hospital data agreement is inactive or expired.');
    const f=await tx.facility(source.facilityId);check(f?.isActive,403,'FACILITY_INACTIVE','Source facility is inactive.');
    const u=await tx.user(source.stewardId);check(u?.status==='active'&&u.role==='facility_admin',403,'SOURCE_STEWARD_INACTIVE','Source steward is inactive.');
  }
  private async datasetLive(tx:Tx,datasetId:string,releaseId:string|null) {
    const dataset=await this.required(tx,'collection',datasetId);
    check(dataset.status==='published'&&releaseId,403,'DATA_NOT_RELEASED','No approved data release is available.');
    const release=await this.required(tx,'release',releaseId);
    check(release.datasetId===dataset.id&&release.status==='published',403,'DATA_NOT_RELEASED','The authorized release is not available.');
    check(release.sourceIds.length>0,403,'SOURCE_NOT_AUTHORIZED','Release has no authorized source.');
    for(const sourceId of release.sourceIds)await this.sourceLive(tx,await this.required(tx,'source',sourceId));
    if(release.quality.warehouse_build_id){const b=await this.required(tx,'omopBuild',release.quality.warehouse_build_id);check(b.status==='published'&&b.releaseId===release.id,403,'WAREHOUSE_NOT_PUBLISHED','Warehouse release was revoked.');for(const batchId of b.batchIds)check((await this.required(tx,'omopBatch',batchId)).status==='accepted',403,'WAREHOUSE_BATCH_REVOKED','A warehouse source batch was revoked.');}
    return {dataset,release};
  }
  private async approvedStudy(tx:Tx,a:Actor,studyId:unknown) {
    const p=await this.required(tx,'study',studyId);
    check(p.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','This research project is not yours.');
    await this.verified(tx,a.sub);
    check(p.status==='approved'&&p.expiresAt>this.clock()&&p.ethicsExpiresAt>this.clock(),403,'PROJECT_NOT_AUTHORIZED','Research authorization is pending, expired or revoked.');
    const data=await this.datasetLive(tx,p.datasetId,p.releaseId);return {study:p,...data};
  }
  private async evidenceReady(tx:Tx,filter:Partial<Evidence>,requiredKinds:string[]) {
    const docs=await tx.list('evidence',filter,100);
    check(requiredKinds.every(kind=>docs.some(d=>d.kind===kind&&d.scanStatus==='clean')),422,'EVIDENCE_REQUIRED','Required scanned evidence is missing.');
  }
  /** All operations, including reads, re-check the live user and resource grants. */
  async run(actor:Actor,action:string,value:unknown={}, apiKeyId?:string) {
    check(this.config.enabled,503,'PORTAL_DISABLED','Research portal is disabled pending configuration.');
    check(this.config.encryptionKey.length===32&&this.config.linkageKey.length===32,503,'CONFIGURATION_REQUIRED','Research keys are not configured.');
    check(['researcher','platform_admin','facility_admin'].includes(actor.role),403,'ROLE_NOT_PERMITTED','Research access is not available for this role.');
    // A separate committed counter transaction means invalid requests still consume a budget.
    await this.store.transaction(async tx=>{
      const u=await tx.user(actor.sub);check(u?.status==='active'&&u.role===actor.role,403,'ACCOUNT_NOT_ACTIVE','Account role/status is no longer authorized.');
      const key='user:'+actor.sub, now=this.clock(); const row=(await tx.list('throttle',{actorKey:key},1))[0];
      if(!row)await tx.insert('throttle',{...this.row(),actorKey:key,windowStart:now,hits:1});
      else if(now.getTime()-row.windowStart.getTime()>=60000)await tx.patch('throttle',row.id,{windowStart:now,hits:1});
      else {check(row.hits<120,429,'RATE_LIMITED','Too many research requests. Retry in a minute.');await tx.patch('throttle',row.id,{hits:row.hits+1});}
    });
    const input=object(value);
    // Never upload a document until ownership is checked. Scanning occurs outside the DB lock.
    let cleanUpload:Buffer|undefined;
    if(action==='evidence.upload') {
      keys(input,['study_id','source_id','kind','content_base64']);
      await this.store.transaction(tx=>this.documentPermission(tx,actor,input));
      cleanUpload=safePdf(input.content_base64);
      try{check(await this.scan(cleanUpload)==='clean',422,'DOCUMENT_SCAN_FAILED','The document was not cleared by the scanner.');}
      catch(e){if(e instanceof PortalError)throw e;throw new PortalError(503,'DOCUMENT_SCANNER_UNAVAILABLE','Document safety scanner is unavailable. Nothing was stored.');}
    }
    let downloadArtifact:DownloadArtifact|undefined;
    if(action==='output.download'){const plan=await this.store.transaction(tx=>this.extensions.downloadPlan(tx,actor,input,this.context()));downloadArtifact=await this.extensions.artifact(plan);}
    return this.store.transaction(async tx=>{
      const current=await tx.user(actor.sub);check(current?.status==='active'&&current.role===actor.role,403,'ACCOUNT_NOT_ACTIVE','Account is no longer authorized.');
      const a=actor;
      if(apiKeyId){const key=await tx.get('key',apiKeyId);check(key&&key.status==='active'&&key.ownerId===a.sub&&key.studyId===input.study_id&&key.expiresAt>this.clock()&&action==='query',401,'API_KEY_INVALID','Research key is inactive or out of scope.');await this.audit(tx,a,'api_read',key.studyId,{keyId:key.id});}
      if(/^(extended\.|warehouse\.|ecrf\.|output\.)/.test(action))return this.extensions.run(tx,a,action,input,this.context(),downloadArtifact);
      switch(action){
        case 'bootstrap': {
          keys(input,[]);
          const isAdmin=a.role==='platform_admin';
          const applications=isAdmin?await tx.list('application',{},100):await tx.list('application',{userId:a.sub},1);
          const studies=isAdmin?await tx.list('study',{},100):await tx.list('study',{ownerId:a.sub},100);
          const collections=await tx.list('collection',isAdmin?{}:{status:'published'},100);
          const sources=isAdmin?await tx.list('source',{},100):a.role==='facility_admin'?await tx.list('source',{stewardId:a.sub},100):[];
          const exports=isAdmin?await tx.list('export',{},100):await tx.list('export',{ownerId:a.sub},100);
          const forms=isAdmin?await tx.list('form',{},100):await tx.list('form',{ownerId:a.sub},100);
          const releases=isAdmin?await tx.list('release',{},100):[];
          const documents=isAdmin?await tx.list('evidence',{},100):await tx.list('evidence',{ownerId:a.sub},100);
          const mappings=isAdmin?await tx.list('mapping',{},1000):[];
          await this.audit(tx,a,'workspace_opened');
          return {role:a.role,user_id:a.sub,access_fee_tzs:0,applications,studies,collections:collections.map(d=>this.catalog(d)),sources,exports,forms,
            releases:releases.map(({cells,...r})=>({...r,published_cell_count:cells.length})),mappings,
            evidence:documents.map(({ciphertext,...d})=>d),
            limits:{aggregate_only:true,minimum_cell_size:10,document_max_bytes:524288,real_data_ingestion:this.config.realDataEnabled},
            notice:'Free access. Verified identity and project authorization are required; no patient-level downloads.'};
        }
        case 'profile.submit': {
          this.researcher(a);keys(input,['kind','display_name','institution','credential_reference','base_version']);
          const kind=oneOf(input.kind,['independent','institutional'],'researcher type');const institution=optionalText(input,'institution',200);
          check(kind!=='institutional'||institution,422,'INSTITUTION_REQUIRED','Institutional researchers must name their institution.');
          const data={kind,displayName:text(input,'display_name',2,150),institution,credentialReference:text(input,'credential_reference',2,150),status:'pending',reviewedBy:null,reviewNote:null};
          const old=(await tx.list('application',{userId:a.sub},1))[0];if(old)this.matchVersion(old,input);
          const row=old?await this.update(tx,'application',old,data):await tx.insert('application',{...this.row(),userId:a.sub,...data});
          await this.audit(tx,a,'identity_submitted',row.id);return row;
        }
        case 'profile.review': {
          this.admin(a);keys(input,['id','base_version','decision','note','identity_checked']);const row=await this.required(tx,'application',input.id);this.matchVersion(row,input);
          check(row.userId!==a.sub,403,'SELF_APPROVAL_FORBIDDEN','You cannot review your own identity.');
          const decision=oneOf(input.decision,['verified','rejected','suspended'],'decision');
          if(decision==='verified'){check(input.identity_checked===true,422,'VERIFICATION_REQUIRED','Verify identity and professional credentials externally.');await this.evidenceReady(tx,{ownerId:row.userId,studyId:null,sourceId:null},['identity']);}
          const out=await this.update(tx,'application',row,{status:decision,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await this.audit(tx,a,'identity_reviewed',row.id,{decision});return out;
        }
        case 'evidence.upload': {
          await this.documentPermission(tx,a,input);check(cleanUpload,503,'DOCUMENT_SCAN_FAILED','Document scan required.');
          const kind=oneOf(input.kind,['identity','protocol','ethics','controller','agreement'],'document kind');
          const studyId=input.study_id?id(input.study_id):null,sourceId=input.source_id?id(input.source_id):null;
          const old=await tx.list('evidence',{ownerId:a.sub,studyId,sourceId},26);check(old.length<25,429,'DOCUMENT_LIMIT','Evidence limit reached.');
          const base=this.row();const row=await tx.insert('evidence',{...base,ownerId:a.sub,studyId,sourceId,kind,sha256:sha(cleanUpload),sizeBytes:cleanUpload.length,scanStatus:'clean',ciphertext:seal(cleanUpload.toString('base64'),this.config.encryptionKey,'evidence:'+base.id)});
          await this.audit(tx,a,'evidence_uploaded',row.id,{kind,bytes:row.sizeBytes});const {ciphertext,...out}=row;return out;
        }
        case 'evidence.download': {
          keys(input,['id']);const row=await this.required(tx,'evidence',input.id);check(a.role==='platform_admin'||row.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Document access denied.');
          check(row.scanStatus==='clean',403,'DOCUMENT_QUARANTINED','This document has not passed scanning.');
          await this.audit(tx,a,'evidence_downloaded',row.id);return {file_name:`evidence-${row.id}.pdf`,content_type:'application/pdf',content_base64:unseal(row.ciphertext,this.config.encryptionKey,'evidence:'+row.id),sha256:row.sha256};
        }
        case 'study.create': {
          this.researcher(a);await this.verified(tx,a.sub);keys(input,['title','purpose','dataset_id','ethics_reference','ethics_expires_at','controller_reference','expires_at','allow_export','allow_ecrf','allow_row_level']);
          const dataset=await this.required(tx,'collection',input.dataset_id);check(dataset.status==='published',422,'DATA_NOT_RELEASED','Select a published dataset.');
          const expiresAt=instant(input.expires_at,'expires_at'),ethicsExpiresAt=instant(input.ethics_expires_at,'ethics_expires_at');
          check(expiresAt>this.clock()&&expiresAt<=ethicsExpiresAt&&expiresAt.getTime()<=this.clock().getTime()+366*86400000,422,'INVALID_EXPIRY','Project access must expire within ethics validity and one year.');
          check(typeof input.allow_export==='boolean'&&typeof input.allow_ecrf==='boolean',422,'INVALID_INPUT','Specify requested access.');
          check(input.allow_row_level===undefined||typeof input.allow_row_level==='boolean',422,'INVALID_INPUT','Row-level scope must be explicitly requested.');
          const row=await tx.insert('study',{...this.row(),ownerId:a.sub,title:text(input,'title',5,200),purpose:text(input,'purpose',20,3000),datasetId:dataset.id,releaseId:null,status:'draft',ethicsReference:text(input,'ethics_reference',3,150),ethicsExpiresAt,controllerReference:text(input,'controller_reference',3,150),expiresAt,allowExport:input.allow_export,allowEcrf:input.allow_ecrf,allowRowLevel:input.allow_row_level===true,reviewedBy:null,reviewNote:null});
          await this.audit(tx,a,'study_created',row.id);return row;
        }
        case 'study.submit': {
          this.researcher(a);keys(input,['id','base_version']);const row=await this.required(tx,'study',input.id);check(row.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Project access denied.');this.matchVersion(row,input);await this.verified(tx,a.sub);
          check(row.status==='draft',409,'STATE_TRANSITION_INVALID','Only draft projects can be submitted.');await this.evidenceReady(tx,{studyId:row.id,ownerId:a.sub},['protocol','ethics','controller']);
          const out=await this.update(tx,'study',row,{status:'submitted'});await this.audit(tx,a,'study_submitted',row.id);return out;
        }
        case 'study.review': {
          this.admin(a);keys(input,['id','base_version','decision','note','ethics_checked','controller_checked','scope_checked','row_level_checked']);const row=await this.required(tx,'study',input.id);this.matchVersion(row,input);check(row.ownerId!==a.sub,403,'SELF_APPROVAL_FORBIDDEN','Independent review is required.');
          const status=oneOf(input.decision,['approved','rejected','revoked'],'decision');let releaseId=row.releaseId;
          if(status==='approved'){
            check(row.status==='submitted',409,'STATE_TRANSITION_INVALID','Only submitted studies can be approved.');await this.verified(tx,row.ownerId);await this.evidenceReady(tx,{studyId:row.id,ownerId:row.ownerId},['protocol','ethics','controller']);
            check(input.ethics_checked===true&&input.controller_checked===true&&input.scope_checked===true,422,'APPROVAL_CHECKS_REQUIRED','Verify external ethics approval, data-controller authorization and requested scope.');
            if(row.allowRowLevel)check(input.row_level_checked===true&&row.allowExport,422,'ROW_LEVEL_REVIEW_REQUIRED','Person-level data needs explicit protocol and controller authorization.');
            check(row.expiresAt>this.clock()&&row.ethicsExpiresAt>=row.expiresAt,422,'INVALID_EXPIRY','Project permission has expired.');
            const d=await this.required(tx,'collection',row.datasetId);await this.datasetLive(tx,d.id,d.latestReleaseId);releaseId=d.latestReleaseId;
          }
          const out=await this.update(tx,'study',row,{status,releaseId,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await this.audit(tx,a,'study_reviewed',row.id,{decision:status});return out;
        }
        case 'collection.create': {
          this.admin(a);keys(input,['name','description','domains','minimum_cell_size','synthetic_only']);
          check(Array.isArray(input.domains)&&input.domains.length>0&&input.domains.length<=6,422,'INVALID_INPUT','Select data domains.');const domains=[...new Set(input.domains.map(d=>oneOf(d,DOMAINS,'domain')))];
          check(typeof input.synthetic_only==='boolean',422,'INVALID_INPUT','Specify synthetic_only.');check(input.synthetic_only||this.config.realDataEnabled,403,'REAL_INGEST_DISABLED','Real data ingestion is not enabled.');
          const name=text(input,'name',3,160);check(!(await tx.list('collection',{name},1)).length,409,'ALREADY_EXISTS','Dataset name already exists.');
          const row=await tx.insert('collection',{...this.row(),name,description:text(input,'description',10,1500),domains,minimumCellSize:integer(input.minimum_cell_size,10,100,'minimum_cell_size'),syntheticOnly:input.synthetic_only,status:'draft',latestReleaseId:null,createdBy:a.sub});
          await this.audit(tx,a,'collection_created',row.id);return this.catalog(row);
        }
        case 'collection.suspend': {
          this.admin(a);keys(input,['id','base_version']);const row=await this.required(tx,'collection',input.id);this.matchVersion(row,input);const out=await this.update(tx,'collection',row,{status:'suspended'});await this.audit(tx,a,'collection_suspended',row.id);return this.catalog(out);
        }
        case 'source.create': {
          this.admin(a);keys(input,['dataset_id','facility_id','steward_id','agreement_reference','expires_at']);const d=await this.required(tx,'collection',input.dataset_id);
          const facilityId=id(input.facility_id),stewardId=id(input.steward_id);check((await tx.facility(facilityId))?.isActive,422,'INVALID_FACILITY','Active facility required.');const user=await tx.user(stewardId);check(user?.status==='active'&&user.role==='facility_admin',422,'INVALID_STEWARD','An active facility-admin account is required.');
          const expiresAt=instant(input.expires_at,'expires_at');check(expiresAt>this.clock()&&expiresAt.getTime()<=this.clock().getTime()+366*86400000,422,'INVALID_EXPIRY','Agreement must expire within one year.');
          const row=await tx.insert('source',{...this.row(),datasetId:d.id,facilityId,stewardId,agreementReference:text(input,'agreement_reference',3,150),expiresAt,status:'pending',createdBy:a.sub,reviewedBy:null});await this.audit(tx,a,'source_created',row.id);return row;
        }
        case 'source.review': {
          this.admin(a);keys(input,['id','base_version','decision','agreement_checked']);const row=await this.required(tx,'source',input.id);this.matchVersion(row,input);
          const status=oneOf(input.decision,['approved','revoked'],'decision');
          if(status==='approved'){check(row.status==='pending'&&row.createdBy!==a.sub,403,'INDEPENDENT_REVIEW_REQUIRED','Another administrator must approve a pending source.');check(input.agreement_checked===true&&row.expiresAt>this.clock(),422,'APPROVAL_CHECKS_REQUIRED','Validate the current hospital agreement.');await this.evidenceReady(tx,{sourceId:row.id},['agreement']);}
          const out=await this.update(tx,'source',row,{status,reviewedBy:a.sub});await this.audit(tx,a,'source_reviewed',row.id,{decision:status});return out;
        }
        case 'mapping.create': {
          this.admin(a);keys(input,['system','source_code','domain','concept_id','vocabulary_version','label','standard_concept','mapping_checked']);check(input.mapping_checked===true,422,'MAPPING_REVIEW_REQUIRED','Verify mappings against licensed standardized vocabularies.');
          const system=oneOf(input.system,SYSTEMS,'system'),sourceCode=text(input,'source_code',1,40),domain=oneOf(input.domain,DOMAINS,'domain');check(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceCode),422,'INVALID_CODE','A coded source value is required.');
          check(!(await tx.list('mapping',{system,sourceCode},1)).length,409,'MAPPING_IMMUTABLE','Mappings are immutable. A vocabulary upgrade requires reviewed migration.');
          check(input.standard_concept===true,422,'STANDARD_MAPPING_REQUIRED','Only verified standard-concept mappings may be published.');
          const row=await tx.insert('mapping',{...this.row(),system,sourceCode,domain,conceptId:integer(input.concept_id,1,2147483647,'concept_id'),standardConcept:true,vocabularyVersion:text(input,'vocabulary_version',1,80),label:text(input,'label',1,160),createdBy:a.sub});await this.audit(tx,a,'mapping_created',row.id);return row;
        }
        case 'ingest': {
          keys(input,['source_id','synthetic','records']);const source=await this.required(tx,'source',input.source_id);
          check(a.role==='facility_admin'&&source.stewardId===a.sub,403,'SOURCE_ACCESS_DENIED','Only the named hospital steward may upload this source.');await this.sourceLive(tx,source);
          const dataset=await this.required(tx,'collection',source.datasetId);check(dataset.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');
          check(typeof input.synthetic==='boolean'&&input.synthetic===dataset.syntheticOnly,422,'SOURCE_MODE_MISMATCH','Synthetic/real mode must match the dataset.');check(dataset.syntheticOnly||this.config.realDataEnabled,403,'REAL_INGEST_DISABLED','Real data ingestion is disabled.');
          check(Array.isArray(input.records)&&input.records.length>0&&input.records.length<=500,422,'BATCH_LIMIT','Provide 1–500 structured records.');const maps=await tx.list('mapping',{},5000);
          let accepted=0,duplicate=0,unmapped=0;const rejected:{row:number;code:string}[]=[];
          for(let n=0;n<input.records.length;n++){
            let transformed;try{transformed=transformEvent(input.records[n],source.id,dataset.id,this.config.linkageKey,maps);check(dataset.domains.includes(transformed.safe.domain),422,'DOMAIN_NOT_ALLOWED','Domain not authorized.');}
            catch(e){if(!(e instanceof PortalError))throw e;rejected.push({row:n+1,code:e.code});continue;}
            const old=(await tx.list('event',{eventHash:transformed.eventHash},1))[0];
            if(old){check(old.payloadHash===transformed.payloadHash,409,'INGEST_VERSION_CONFLICT','An event identifier already has a different payload. Use a new source version.');duplicate++;continue;}
            const row=this.row();await tx.insert('event',{...row,datasetId:dataset.id,sourceId:source.id,eventHash:transformed.eventHash,payloadHash:transformed.payloadHash,ciphertext:seal(JSON.stringify(transformed.safe),this.config.encryptionKey,'event:'+row.id)});accepted++;if(!transformed.safe.concept_id)unmapped++;
          }
          await this.audit(tx,a,'batch_ingested',dataset.id,{accepted,duplicate,rejected:rejected.length,unmapped});return {accepted,duplicate,rejected,unmapped,raw_payload_retained:false,note:'Unmapped codes remain in encrypted staging and cannot be published. Free-text fields are rejected.'};
        }
        case 'release.prepare': {
          this.admin(a);keys(input,['dataset_id']);const d=await this.required(tx,'collection',input.dataset_id);check(d.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');
          const rows=await tx.list('event',{datasetId:d.id},20001);check(rows.length>0&&rows.length<=20000,422,'RELEASE_SIZE_LIMIT','Prepare releases with 1–20,000 staged events; larger ETL requires a reviewed worker.');
          const sourceIds=[...new Set(rows.map(e=>e.sourceId))];
          check(sourceIds.length===1,422,'CROSS_SOURCE_LINKAGE_REVIEW_REQUIRED','Publish each hospital source separately until cross-source subject linkage and disclosure policy are validated.');
          for(const sid of sourceIds)await this.sourceLive(tx,await this.required(tx,'source',sid));
          const events=rows.map(r=>JSON.parse(unseal(r.ciphertext,this.config.encryptionKey,'event:'+r.id)));const maps=await tx.list('mapping',{},5000);
          const {cells,withheld}=makeRelease(events,maps,d.minimumCellSize);
          const omop=omopReadiness(events.map(event=>{const mapping=maps.find(m=>m.system===event.code_system&&m.sourceCode===event.code&&m.domain===event.domain&&m.standardConcept);return {...event,concept_id:mapping?.conceptId??0,mapping_version:mapping?.vocabularyVersion??null};}));
          const quality={staged_events:rows.length,unmapped_events:omop.unmapped,mapping_coverage:Math.round(100*omop.mapped/rows.length),withheld_cells:withheld,transform_version:'structured-aggregate-v1'};
          const release=await tx.insert('release',{...this.row(),datasetId:d.id,status:'pending',sourceIds,cells,quality,minimumCellSize:d.minimumCellSize,contentHash:sha(JSON.stringify(cells)),createdBy:a.sub,reviewedBy:null,reviewNote:null});
          await this.audit(tx,a,'release_prepared',release.id,{cells:cells.length});return {...release,omop};
        }
        case 'release.inspect': {
          this.admin(a);keys(input,['id']);const row=await this.required(tx,'release',input.id);await this.audit(tx,a,'release_inspected',row.id);return row;
        }
        case 'release.review': {
          this.admin(a);keys(input,['id','base_version','decision','note','disclosure_checked','provenance_checked']);const row=await this.required(tx,'release',input.id);this.matchVersion(row,input);
          const status=oneOf(input.decision,['published','rejected','revoked'],'decision');
          if(status==='published'){
            check(row.status==='pending'&&row.createdBy!==a.sub,403,'INDEPENDENT_REVIEW_REQUIRED','Another administrator must review a pending release.');
            check(input.disclosure_checked===true&&input.provenance_checked===true&&row.cells.length>0,422,'DISCLOSURE_REVIEW_REQUIRED','Review disclosure risk, mappings and provenance before publication.');
            const d=await this.required(tx,'collection',row.datasetId);check(d.status!=='suspended',403,'DATASET_SUSPENDED','Dataset is suspended.');for(const sid of row.sourceIds)await this.sourceLive(tx,await this.required(tx,'source',sid));
            await this.update(tx,'collection',d,{status:'published',latestReleaseId:row.id});
          }
          const out=await this.update(tx,'release',row,{status,reviewedBy:a.sub,reviewNote:text(input,'note',5,500)});await this.audit(tx,a,'release_reviewed',row.id,{decision:status});return out;
        }
        case 'query': {
          this.researcher(a);keys(input,['study_id','filters']);const {study,dataset,release}=await this.approvedStudy(tx,a,input.study_id);
          const filters=parseFilters(input.filters),cells=filterCells(release.cells,filters);await this.audit(tx,a,'aggregate_queried',study.id,{releaseId:release.id,returnedCells:cells.length});
          return {study_id:study.id,release_id:release.id,release_hash:release.contentHash,minimum_cell_size:release.minimumCellSize,synthetic:dataset.syntheticOnly,fee_tzs:0,cells,disclosure_notice:'Only published cells are returned. Hidden small cells and totals are not exposed. Counts across cells may overlap and must not be summed as unique patients.'};
        }
        case 'export.request': {
          this.researcher(a);keys(input,['study_id','format','filters']);const {study,release}=await this.approvedStudy(tx,a,input.study_id);check(study.allowExport,403,'EXPORT_NOT_AUTHORIZED','Project authorization does not include export.');
          const format=oneOf(input.format,['csv','xlsx','json','xml'],'export format'),filters=parseFilters(input.filters);
          const pending=await tx.list('export',{studyId:study.id,status:'pending'},21);check(pending.length<20,429,'EXPORT_LIMIT','Review pending export requests first.');
          const row=await tx.insert('export',{...this.row(),studyId:study.id,ownerId:a.sub,releaseId:release.id,format,filters,status:'pending',reviewedBy:null,expiresAt:new Date(Math.min(study.expiresAt.getTime(),this.clock().getTime()+7*86400000))});await this.audit(tx,a,'export_requested',row.id);return row;
        }
        case 'export.inspect': {
          this.admin(a);keys(input,['id']);const row=await this.required(tx,'export',input.id);
          const {release}=await this.approvedStudy(tx,{sub:row.ownerId,role:'researcher'},row.studyId);
          check(release.id===row.releaseId,403,'EXPORT_NOT_AUTHORIZED','Release no longer matches this request.');
          await this.audit(tx,a,'export_inspected',row.id);return {request:row,cells:filterCells(release.cells,row.filters),minimum_cell_size:release.minimumCellSize};
        }
        case 'export.review': {
          this.admin(a);keys(input,['id','base_version','decision','output_checked']);const row=await this.required(tx,'export',input.id);this.matchVersion(row,input);check(row.ownerId!==a.sub&&row.status==='pending',403,'INDEPENDENT_REVIEW_REQUIRED','An independent pending-export review is required.');
          const status=oneOf(input.decision,['approved','rejected'],'decision');if(status==='approved'){check(input.output_checked===true&&row.expiresAt>this.clock(),422,'OUTPUT_REVIEW_REQUIRED','Review the requested published-cell output.');await this.approvedStudy(tx,{sub:row.ownerId,role:'researcher'},row.studyId);}
          const out=await this.update(tx,'export',row,{status,reviewedBy:a.sub});await this.audit(tx,a,'export_reviewed',row.id,{decision:status});return out;
        }
        case 'export.download': {
          this.researcher(a);keys(input,['id']);const row=await this.required(tx,'export',input.id);check(row.ownerId===a.sub&&row.status==='approved'&&row.expiresAt>this.clock(),403,'EXPORT_NOT_AUTHORIZED','This export is not currently authorized.');
          const {study,release}=await this.approvedStudy(tx,a,row.studyId);check(release.id===row.releaseId&&study.allowExport,403,'EXPORT_NOT_AUTHORIZED','Export authorization has changed.');
          const cells=filterCells(release.cells,row.filters),file=formatExport(cells,row.format,{release_id:release.id,release_hash:release.contentHash,minimum_cell_size:release.minimumCellSize});await this.audit(tx,a,'export_downloaded',row.id,{format:row.format,releaseId:release.id});return file;
        }
        case 'form.create': {
          this.researcher(a);keys(input,['study_id','title','fields']);const {study}=await this.approvedStudy(tx,a,input.study_id);check(study.allowEcrf,403,'ECRF_NOT_AUTHORIZED','Prospective data collection is not approved for this project.');
          const row=await tx.insert('form',{...this.row(),studyId:study.id,ownerId:a.sub,title:text(input,'title',3,160),fields:parseFields(input.fields),status:'draft',reviewedBy:null});await this.audit(tx,a,'form_created',row.id);return row;
        }
        case 'form.review': {
          this.admin(a);keys(input,['id','base_version','decision','protocol_checked']);const row=await this.required(tx,'form',input.id);this.matchVersion(row,input);check(row.ownerId!==a.sub&&row.status==='draft',403,'INDEPENDENT_REVIEW_REQUIRED','An independent form review is required.');
          const status=oneOf(input.decision,['published','rejected'],'decision');if(status==='published'){check(input.protocol_checked===true,422,'PROTOCOL_REVIEW_REQUIRED','Verify field definitions against the approved protocol; no direct identifiers.');const {study}=await this.approvedStudy(tx,{sub:row.ownerId,role:'researcher'},row.studyId);check(study.allowEcrf,403,'ECRF_NOT_AUTHORIZED','Collection scope is not approved.');}
          const out=await this.update(tx,'form',row,{status,reviewedBy:a.sub});await this.audit(tx,a,'form_reviewed',row.id,{decision:status});return out;
        }
        case 'form.respond': {
          this.researcher(a);keys(input,['form_id','subject_code','consent_reference','consent_confirmed','answers']);const form=await this.required(tx,'form',input.form_id);const {study}=await this.approvedStudy(tx,a,form.studyId);
          check(study.allowEcrf&&form.status==='published'&&form.ownerId===a.sub,403,'ECRF_NOT_AUTHORIZED','Form collection is not authorized.');check(input.consent_confirmed===true,422,'CONSENT_REQUIRED','Confirm documented participant consent under the approved protocol.');
          const subject=text(input,'subject_code',3,80);check(/^[A-Z0-9_-]+$/.test(subject),422,'INVALID_SUBJECT_CODE','Use a study-assigned code, not a name or phone number.');const subjectHash=keyed(this.config.linkageKey,'ecrf-subject',study.id,subject),consentReferenceHash=keyed(this.config.linkageKey,'ecrf-consent',study.id,text(input,'consent_reference',3,120));
          check(!(await tx.list('response',{formId:form.id,subjectHash},1)).length,409,'RESPONSE_EXISTS','This subject already has a response for this immutable form.');
          const row=this.row(),answers=validateAnswers(form.fields,input.answers);await tx.insert('response',{...row,formId:form.id,subjectHash,consentReferenceHash,submittedBy:a.sub,status:'active',withdrawnAt:null,withdrawalCode:null,ciphertext:seal(JSON.stringify(answers),this.config.encryptionKey,'response:'+row.id)});
          await this.audit(tx,a,'ecrf_response_recorded',row.id,{formId:form.id});return {id:row.id,form_id:form.id,status:'recorded',note:'Encrypted research-only response; no clinical record changed.'};
        }
        case 'key.create': {
          this.researcher(a);keys(input,['study_id']);const {study}=await this.approvedStudy(tx,a,input.study_id);const existing=await tx.list('key',{studyId:study.id,status:'active'},6);check(existing.length<5,429,'KEY_LIMIT','Revoke an existing project key before creating another.');
          const token='ahr_'+randomBytes(32).toString('hex');const row=await tx.insert('key',{...this.row(),studyId:study.id,ownerId:a.sub,tokenHash:sha(token),status:'active',expiresAt:new Date(Math.min(study.expiresAt.getTime(),this.clock().getTime()+30*86400000))});await this.audit(tx,a,'api_key_created',row.id);return {id:row.id,token,expires_at:row.expiresAt,scope:'published_aggregates:read',study_id:study.id};
        }
        case 'key.list': {this.researcher(a);keys(input,[]);return (await tx.list('key',{ownerId:a.sub},100)).map(({tokenHash,...k})=>k);}
        case 'key.revoke': {
          this.researcher(a);keys(input,['id']);const row=await this.required(tx,'key',input.id);check(row.ownerId===a.sub,403,'NOT_RESOURCE_OWNER','Key access denied.');const out=await this.update(tx,'key',row,{status:'revoked'});await this.audit(tx,a,'api_key_revoked',row.id);return {id:out.id,status:out.status};
        }
        default: throw new PortalError(404,'NOT_FOUND','Research operation not found.');
      }
    });
  }
  private async documentPermission(tx:Tx,a:Actor,input:Record<string,unknown>) {
    const kind=oneOf(input.kind,['identity','protocol','ethics','controller','agreement'],'kind');
    check(!(input.study_id&&input.source_id),422,'INVALID_DOCUMENT_SCOPE','Choose a single document scope.');
    if(input.study_id){const study=await this.required(tx,'study',input.study_id);check(study.ownerId===a.sub&&study.status==='draft'&&['protocol','ethics','controller'].includes(kind),403,'DOCUMENT_ACCESS_DENIED','Only the owner may attach evidence to a draft study.');}
    else if(input.source_id){const source=await this.required(tx,'source',input.source_id);check(kind==='agreement'&&source.status==='pending'&&((a.role==='facility_admin'&&source.stewardId===a.sub)||(a.role==='platform_admin'&&source.createdBy===a.sub)),403,'DOCUMENT_ACCESS_DENIED','Source document access denied.');}
    else {this.researcher(a);check(kind==='identity',422,'INVALID_DOCUMENT_SCOPE','Study/source reference required for this document.');}
  }
  private catalog(d:Collection){return {id:d.id,name:d.name,description:d.description,domains:d.domains,minimumCellSize:d.minimumCellSize,status:d.status,syntheticOnly:d.syntheticOnly,latestReleaseId:d.latestReleaseId,version:d.version,access_fee_tzs:0,output:'reviewed_aggregate_cells'};}
  /** Machine API tokens never grant direct database access or ownership override. */
  async api(token:string,studyId:string,format:'json'|'xml') {
    check(/^ahr_[a-f0-9]{64}$/.test(token),401,'API_KEY_INVALID','Research API key required.');
    const key=await this.store.transaction(async tx=>(await tx.list('key',{tokenHash:sha(token)},1))[0]);
    check(key&&key.status==='active'&&key.studyId===id(studyId)&&key.expiresAt>this.clock(),401,'API_KEY_INVALID','Research API key is inactive or out of scope.');
    // run() rechecks account, identity, approval, expiry, dataset/release and all source agreements.
    const data=await this.run({sub:key.ownerId,role:'researcher'},'query',{study_id:studyId,filters:{}},key.id) as {cells:Rows['release']['cells'];release_id:string;release_hash:string;minimum_cell_size:number};
    return formatExport(data.cells,format,{release_id:data.release_id,release_hash:data.release_hash,minimum_cell_size:data.minimum_cell_size});
  }
}
