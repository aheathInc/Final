import { PrismaClient } from '@a-health/database';
import type { BuildInput, Materialized, Vocabulary, WarehouseConfig, WarehousePort, Concept } from './types.js';
import type { SqlClient, SqlDb, CdmRow } from './sql.js';
import { TABLES, TABLE_MAP, CDM_VERSION } from './catalog.js';
import { createStatements, constraintStatements, identifier, schemaName, insertRows, immutableStatements } from './sql.js';
import { aggregateTables, ETL_VERSION, mappingKeys, planTables, quality, tableDigest } from './etl.js';
import { mergeBundles } from './bundle.js';
import { check, sha, PortalError } from '../portal/policy.js';
export const CONTROL='ahp_research_warehouse';
export class PostgresWarehouse implements WarehousePort {
  private db:SqlClient|null=null;
  constructor(public readonly config:WarehouseConfig, db?:SqlClient){if(db)this.db=db;}
  client():SqlClient{
    check(this.config.enabled,503,'WAREHOUSE_DISABLED','Dedicated OMOP warehouse is disabled.');
    if(!this.db)this.db=new PrismaClient({datasources:{db:{url:this.config.databaseUrl}},log:[]}) as unknown as SqlClient;
    return this.db;
  }
  async verifyIdentity():Promise<void>{
    const rows=await this.client().$queryRawUnsafe<Array<{database:string;role:string;superuser:boolean}>>('SELECT current_database() AS database, current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser');
    check(rows.length===1&&rows[0].database===this.config.expectedDatabase&&rows[0].role===decodeURIComponent(new URL(this.config.databaseUrl).username)&&!rows[0].superuser,503,'WAREHOUSE_IDENTITY_MISMATCH','Dedicated non-superuser warehouse identity could not be verified.');
  }
  /** Explicit operator action only. Never invoked automatically by application startup. */
  async initialize():Promise<void>{
    await this.verifyIdentity();const db=this.client();
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(726342,1)`);
      await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${CONTROL}`);
      const owner=await tx.$queryRawUnsafe<Array<{owned:boolean}>>(`SELECT nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_namespace WHERE nspname=$1`,CONTROL);
      check(owner[0]?.owned,503,'WAREHOUSE_OWNER_MISMATCH','Warehouse control schema must belong to the configured role.');
      await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA ${CONTROL} FROM PUBLIC`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CONTROL}.vocabulary_release (id text PRIMARY KEY, schema_name text UNIQUE NOT NULL, version varchar(20) NOT NULL, synthetic boolean NOT NULL, content_hash text NOT NULL, status text NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CONTROL}.identity_map (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope_hash text NOT NULL, table_name text NOT NULL, source_hash text NOT NULL, UNIQUE(scope_hash,table_name,source_hash))`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${CONTROL}.build_manifest (id text PRIMARY KEY, schema_name text UNIQUE NOT NULL, source_hash text NOT NULL, vocabulary_id text NOT NULL REFERENCES ${CONTROL}.vocabulary_release(id), manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA ${CONTROL} FROM PUBLIC`);
    },{maxWait:10000,timeout:30000});
  }
  async status(){
    if(!this.config.enabled)return {enabled:false,ready:false,cdm_version:CDM_VERSION,table_count:TABLES.length,vocabulary_version:null,synthetic:null};
    await this.verifyIdentity();
    const ready=await this.client().$queryRawUnsafe<Array<{exists:boolean}>>(`SELECT to_regclass($1) IS NOT NULL AS exists`,CONTROL+'.vocabulary_release');
    if(!ready[0]?.exists)return {enabled:true,ready:false,cdm_version:CDM_VERSION,table_count:TABLES.length,vocabulary_version:null,synthetic:null};
    const rows=await this.client().$queryRawUnsafe<Array<{version:string;synthetic:boolean}>>(`SELECT version,synthetic FROM ${CONTROL}.vocabulary_release WHERE status='active' ORDER BY created_at DESC LIMIT 1`);
    return {enabled:true,ready:rows.length===1,cdm_version:CDM_VERSION,table_count:TABLES.length,vocabulary_version:rows[0]?.version??null,synthetic:rows[0]?.synthetic??null};
  }
  async vocabulary(requiredIds:number[]=[]):Promise<Vocabulary>{
    await this.verifyIdentity();const db=this.client();
    const rows=await db.$queryRawUnsafe<Array<{id:string;schema_name:string;version:string;synthetic:boolean;content_hash:string}>>(`SELECT id,schema_name,version,synthetic,content_hash FROM ${CONTROL}.vocabulary_release WHERE status='active' ORDER BY created_at DESC LIMIT 1`);
    check(rows.length===1,503,'VOCABULARY_REQUIRED','Import an authorized, versioned Athena vocabulary release first.');
    const r=rows[0],s=schemaName(r.schema_name),set=new Set(requiredIds);set.add(0);
    // Load only concepts referenced by the job plus ingredient ancestors and field/domain metadata.
    const ancestors=await db.$queryRawUnsafe<Array<{ancestor_concept_id:number;descendant_concept_id:number}>>(`SELECT ca.ancestor_concept_id,ca.descendant_concept_id FROM ${s}.concept_ancestor ca JOIN ${s}.concept c ON c.concept_id=ca.ancestor_concept_id WHERE ca.descendant_concept_id = ANY($1::integer[]) AND c.concept_class_id='Ingredient'`,[...set]);
    ancestors.forEach(a=>set.add(a.ancestor_concept_id));
    const concepts=await db.$queryRawUnsafe<Array<Concept & {valid_start_date:string|Date;valid_end_date:string|Date}>>(`SELECT concept_id,concept_name,domain_id,vocabulary_id,concept_class_id,standard_concept,concept_code,valid_start_date,valid_end_date,invalid_reason FROM ${s}.concept WHERE concept_id=ANY($1::integer[]) OR vocabulary_id='CDM' OR (domain_id='Metadata' AND concept_class_id IN ('Domain','Field'))`,[...set]);
    const toDate=(d:string|Date)=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
    const domains=await db.$queryRawUnsafe<Array<{domain_id:string;domain_concept_id:number}>>(`SELECT domain_id,domain_concept_id FROM ${s}.domain`);
    return {id:r.id,schema:r.schema_name,version:r.version,synthetic:r.synthetic,hash:r.content_hash,concepts:new Map(concepts.map(c=>[c.concept_id,{...c,valid_start_date:toDate(c.valid_start_date),valid_end_date:toDate(c.valid_end_date)}])),ancestors,domains:new Map(domains.map(d=>[d.domain_concept_id,d.domain_id]))};
  }
  private async identities(input:BuildInput,keys:string[]):Promise<Map<string,number>>{
    const db=this.client(),scope=sha(input.datasetId+':'+input.sourceId),result=new Map<string,number>();
    await db.$transaction(async tx=>{
      for(let i=0;i<keys.length;i+=200){
        const part=keys.slice(i,i+200),params:unknown[]=[];
        const tuples=part.map(key=>{const idx=key.indexOf(':');params.push(scope,key.slice(0,idx),key.slice(idx+1));return `($${params.length-2},$${params.length-1},$${params.length})`;}).join(',');
        if(!part.length)continue;
        await tx.$executeRawUnsafe(`INSERT INTO ${CONTROL}.identity_map (scope_hash,table_name,source_hash) VALUES ${tuples} ON CONFLICT(scope_hash,table_name,source_hash) DO NOTHING`,...params);
      }
      const all=await tx.$queryRawUnsafe<Array<{id:number;table_name:string;source_hash:string}>>(`SELECT id,table_name,source_hash FROM ${CONTROL}.identity_map WHERE scope_hash=$1`,scope);
      for(const row of all)result.set(row.table_name+':'+row.source_hash,row.id);
    },{maxWait:10000,timeout:60000});return result;
  }
  async materialize(input:BuildInput):Promise<Materialized>{
    check(this.config.enabled,503,'WAREHOUSE_DISABLED','Warehouse is disabled.');await this.verifyIdentity();const db=this.client();
    const existing=await db.$queryRawUnsafe<Array<{source_hash:string;manifest:Materialized}>>(`SELECT source_hash,manifest FROM ${CONTROL}.build_manifest WHERE id=$1`,input.buildId);
    if(existing.length){check(existing[0].source_hash===input.sourceHash,409,'WAREHOUSE_BUILD_CONFLICT','Build id has different source content.');return existing[0].manifest;}
    const raw=mergeBundles(input.bundles,this.config.maxRows),ids=new Set<number>(input.mappings.map(m=>m.conceptId));
    for(const [name,rows]of Object.entries(raw))for(const row of rows)for(const c of TABLE_MAP.get(name)!.columns)if(c.references?.[0]==='concept'&&typeof row[c.name]==='number')ids.add(Number(row[c.name]));
    const vocab=await this.vocabulary([...ids]);check(!vocab.synthetic||input.synthetic,403,'SYNTHETIC_VOCABULARY','Synthetic vocabulary fixtures cannot process real hospital data.');
    const mapping=await this.identities(input,mappingKeys(raw,vocab)),tables=planTables(input,vocab,mapping,this.config.maxRows),now=new Date().toISOString();
    const cdmConcept=[...vocab.concepts.values()].find(c=>c.vocabulary_id==='CDM'&&!c.invalid_reason&&(c.concept_id===756265||['5.4','5.4.0','OMOP CDM 5.4','CDM v5.4.0'].includes(c.concept_code)));
    check(cdmConcept,422,'CDM_VERSION_CONCEPT_REQUIRED','The vocabulary must contain the OMOP CDM 5.4 version concept.');
    tables.cdm_source=[{cdm_source_name:'AHP approved research source',cdm_source_abbreviation:input.sourceId.slice(0,25),cdm_holder:'A-Health governed research',source_description:input.datePolicy+'; pseudonymized, NOT anonymous',source_documentation_reference:'docs/research-portal/WAREHOUSE.md',cdm_etl_reference:ETL_VERSION,source_release_date:now.slice(0,10),cdm_release_date:now.slice(0,10),cdm_version:CDM_VERSION,cdm_version_concept_id:cdmConcept.concept_id,vocabulary_version:vocab.version}];
    tables.metadata=[{metadata_id:1,metadata_concept_id:0,metadata_type_concept_id:0,name:'AHP source fingerprint',value_as_string:input.sourceHash,value_as_concept_id:null,value_as_number:null,metadata_date:now.slice(0,10),metadata_datetime:null},{metadata_id:2,metadata_concept_id:0,metadata_type_concept_id:0,name:'AHP date policy',value_as_string:input.datePolicy,value_as_concept_id:null,value_as_number:null,metadata_date:now.slice(0,10),metadata_datetime:null}];
    const dq=quality(tables,vocab);if(!dq.passed)throw new WarehouseQualityError(dq);
    check(tables.person.length>0,422,'WAREHOUSE_PERSON_REQUIRED','Supply person rows and explicit observation periods.');
    const {cells,withheld}=aggregateTables(tables,vocab,input.minimumCellSize);check(cells.length<=5000,422,'RELEASE_TOO_LARGE','Partition the data into reviewed releases.');
    const schema='ahp_omop_'+input.buildId.replaceAll('-',''),tableHashes=Object.fromEntries(TABLES.filter(t=>!t.vocabulary).map(t=>[t.name,tableDigest(tables[t.name],t.name)]));
    const manifestHash=sha(JSON.stringify({source:input.sourceHash,vocabulary:vocab.hash,datePolicy:input.datePolicy,tables:tableHashes,etl:ETL_VERSION}));
    const manifest:Materialized={schema,vocabularyId:vocab.id,vocabularyVersion:vocab.version,sourceHash:input.sourceHash,manifestHash,quality:dq,cells,withheld,persons:tables.person.length,createdAt:now};
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(726342,2)');
      const again=await tx.$queryRawUnsafe<Array<{source_hash:string}>>(`SELECT source_hash FROM ${CONTROL}.build_manifest WHERE id=$1`,input.buildId);check(!again.length,409,'WAREHOUSE_BUILD_BUSY','This build was already materialized. Retry status.');
      for(const statement of createStatements(schema,vocab.schema))await tx.$executeRawUnsafe(statement);
      for(const table of TABLES.filter(t=>!t.vocabulary))await insertRows(tx,schema,table.name,tables[table.name]);
      for(const statement of constraintStatements(schema,vocab.schema))await tx.$executeRawUnsafe(statement);
      for(const statement of immutableStatements(schema))await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName(schema)} FROM PUBLIC`);
      // Persist hashes with the immutable snapshot. Failure rolls back schema + rows + manifest together.
      await tx.$executeRawUnsafe(`INSERT INTO ${CONTROL}.build_manifest(id,schema_name,source_hash,vocabulary_id,manifest) VALUES($1,$2,$3,$4,$5::jsonb)`,input.buildId,schema,input.sourceHash,vocab.id,JSON.stringify({...manifest,tableHashes,etlVersion:ETL_VERSION,datePolicy:input.datePolicy}));
    },{maxWait:10000,timeout:300000});return manifest;
  }
  async extract(schema:string,expectedHash:string){
    await this.verifyIdentity();const db=this.client();const result=await db.$queryRawUnsafe<Array<{manifest:Materialized&{tableHashes:Record<string,string>}}>>(`SELECT manifest FROM ${CONTROL}.build_manifest WHERE schema_name=$1`,schema);
    check(result.length===1&&result[0].manifest.manifestHash===expectedHash,409,'WAREHOUSE_SNAPSHOT_CHANGED','Warehouse snapshot does not match its approved manifest.');
    const manifest=result[0].manifest,tables:Record<string,CdmRow[]>={};let total=0;
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      for(const table of TABLES){
        // Licensed vocabulary redistribution is not assumed; consumers load the same authorized release.
        if(table.vocabulary){tables[table.name]=[];continue;}
        const rows=await tx.$queryRawUnsafe<Record<string,unknown>[]>(`SELECT * FROM ${schemaName(schema)}.${identifier(table.name)} LIMIT $1`,this.config.maxRows+1);
        total+=rows.length;check(total<=this.config.maxRows,413,'EXPORT_TOO_LARGE','Snapshot exceeds the bounded download size. Partition the approved dataset.');
        tables[table.name]=rows.map(row=>Object.fromEntries(table.columns.map(c=>{let v=row[c.name];if(v instanceof Date)v=c.type==='date'?v.toISOString().slice(0,10):v.toISOString();else if(v!==null&&v!==undefined&&c.type==='numeric')v=Number(v);return [c.name,v??null];})) as CdmRow);
        check(tableDigest(tables[table.name],table.name)===manifest.tableHashes[table.name],409,'WAREHOUSE_SNAPSHOT_CHANGED','Warehouse rows differ from their approved content hash.');
      }
    },{maxWait:10000,timeout:60000});
    const {cells,...publicManifest}=manifest;
    return {tables,manifest:{...publicManifest,vocabulary_distribution:'metadata and headers only; obtain the same licensed Athena release independently',pseudonymized_not_anonymous:true}};
  }
  async close(){await this.db?.$disconnect();}
}

export class WarehouseQualityError extends PortalError {
  constructor(public readonly qualityReport:import('./types.js').QualityReport){super(422,'WAREHOUSE_QUALITY_FAILED','Structured data failed validation. Inspect the protected quality report; no row values are exposed.');}
}
