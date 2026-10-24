'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load,vocabulary,buildInput}=require('./fixture.cjs');
const {PostgresWarehouse}=load('services/research/src/warehouse/postgres.ts',{'@a-health/database':{PrismaClient:class{constructor(){throw Error('Unexpected real DB connection');}}}});
const {loadVocabulary}=load('services/research/src/warehouse/vocabulary.ts',{'@a-health/database':{PrismaClient:class{}}});
const {TABLES}=load('services/research/src/warehouse/catalog.ts');
const config={enabled:true,databaseUrl:'postgresql://warehouse:synthetic-placeholder@127.0.0.1:55439/ahealth_research_test',expectedDatabase:'ahealth_research_test',maxRows:50000,workerEnabled:false};
class SqlDouble {
 constructor(){this.sql=[];this.tables=new Map();this.manifests=new Map();this.ids=[];this.failAt='';this.identity={database:config.expectedDatabase,role:'warehouse',superuser:false};this.v=vocabulary();this.failTransaction=false;this.vocabularyStatus=null;}
 async $disconnect(){}
 async $transaction(fn){const state=structuredClone({tables:this.tables,manifests:this.manifests,ids:this.ids,sql:this.sql});try{const value=await fn(this);if(this.failTransaction)throw Error('Synthetic commit failure');return value;}catch(e){Object.assign(this,state);throw e;}}
 async $executeRawUnsafe(q,...args){this.sql.push([q,args]);if(this.failAt&&q.includes(this.failAt))throw Error('Synthetic DB failure');
 if(q.includes('.identity_map (scope_hash'))for(let i=0;i<args.length;i+=3)if(!this.ids.some(r=>r.scope_hash===args[i]&&r.table_name===args[i+1]&&r.source_hash===args[i+2]))this.ids.push({id:this.ids.length+1,scope_hash:args[i],table_name:args[i+1],source_hash:args[i+2]});
 const insert=q.match(/^INSERT INTO "(ahp_(?:omop|vocab)_[a-f0-9]+)"\."([a-z_]+)"/);if(insert){const spec=TABLES.find(t=>t.name===insert[2]),rows=this.tables.get(insert[1]+'.'+insert[2])??[];for(let i=0;i<args.length;i+=spec.columns.length)rows.push(Object.fromEntries(spec.columns.map((c,j)=>[c.name,args[i+j]])));this.tables.set(insert[1]+'.'+insert[2],rows);}
 if(q.includes('.build_manifest(id,'))this.manifests.set(args[0],{source_hash:args[2],schema_name:args[1],manifest:JSON.parse(args[4])});
 if(q.includes("SET status='failed'"))this.vocabularyStatus='failed';
 if(q.includes("SET status='active'"))this.vocabularyStatus='active';
 return 1;
 }
 async $queryRawUnsafe(q,...args){this.sql.push([q,args]);if(q.startsWith('SELECT current_database'))return [this.identity];if(q.includes('nspowner='))return [{owned:true}];if(q.includes('to_regclass'))return [{exists:true}];
 if(q.includes('build_manifest WHERE id='))return this.manifests.has(args[0])?[this.manifests.get(args[0])]:[];
 if(q.includes('build_manifest WHERE schema_name='))return [...this.manifests.values()].filter(m=>m.schema_name===args[0]);
 if(q.includes('vocabulary_release WHERE id='))return [];
 if(q.includes("vocabulary_release WHERE status='active'"))return [{id:this.v.id,schema_name:this.v.schema,version:this.v.version,synthetic:true,content_hash:this.v.hash}];
 if(q.includes('JOIN')&&q.includes('concept_ancestor'))return this.v.ancestors;
 if(q.includes('SELECT concept_id,concept_name'))return [...this.v.concepts.values()];
 if(q.includes('SELECT domain_id,domain_concept_id'))return [];
 if(q.includes('FROM ahp_research_warehouse.identity_map'))return this.ids.filter(x=>x.scope_hash===args[0]);
 if(q.startsWith('SELECT count(*) AS count'))return [{count:2n}];
 const select=q.match(/^SELECT \* FROM "([a-z0-9_]+)"\."([a-z_]+)"/);if(select){return (this.tables.get(select[1]+'.'+select[2])??[]).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k.endsWith('_datetime')&&v?new Date(v):v])));}
 throw Error('SQL double needs explicit query support: '+q);
 }
}
test('Dedicated identity verification rejects unexpected role and superuser',async()=>{for(const patch of [{role:'other'},{superuser:true},{database:'ahealth_dev'}]){const db=new SqlDouble();Object.assign(db.identity,patch);const w=new PostgresWarehouse(config,db);await a.rejects(w.initialize(),e=>e.code==='WAREHOUSE_IDENTITY_MISMATCH');a.equal(db.sql.filter(([q])=>q.startsWith('CREATE')).length,0);}});
test('Disabled warehouse never connects or creates schema',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse({...config,enabled:false},db);a.equal((await w.status()).enabled,false);await a.rejects(w.materialize(buildInput()),e=>e.code==='WAREHOUSE_DISABLED');a.equal(db.sql.length,0);});
test('Actual PostgreSQL adapter builds schema graph, passes bound values, stores manifest and verifies readback through SQL double',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db),input=buildInput();const b=await w.materialize(input);a.equal(b.persons,20);a.equal(b.quality.passed,true);a.equal(db.sql.filter(([q])=>q.startsWith('CREATE TABLE "ahp_omop_')).length,29);a.equal(db.sql.filter(([q])=>q.startsWith('CREATE VIEW')).length,10);const out=await w.extract(b.schema,b.manifestHash);a.equal(out.tables.person.length,20);a.equal(out.tables.concept.length,0);a.ok(out.manifest.pseudonymized_not_anonymous);a.equal((await w.materialize(input)).manifestHash,b.manifestHash);});
test('SQL adapter rejects modified snapshot rows after approval',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db),b=await w.materialize(buildInput());db.tables.get(b.schema+'.person')[0].year_of_birth=1980;await a.rejects(w.extract(b.schema,b.manifestHash),e=>e.code==='WAREHOUSE_SNAPSHOT_CHANGED');});
test('Warehouse schema, rows and manifest rollback together on commit failure in SQL double',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db);db.failAt='ADD FOREIGN KEY';await a.rejects(w.materialize(buildInput()));a.equal(db.tables.size,0);a.equal(db.manifests.size,0);});
test('Detailed quality errors contain counts and columns, not source rows',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db),i=buildInput();i.bundles[0].tables.person[0].year_of_birth=null;await a.rejects(w.materialize(i),e=>{a.equal(e.code,'WAREHOUSE_QUALITY_FAILED');a.ok(e.qualityReport.issues.length);a.ok(!JSON.stringify(e.qualityReport).includes('SYNTHETIC_PERSON'));return true;});a.equal(db.manifests.size,0);});
test('Synthetic vocab cannot materialize a real-data source',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db),i=buildInput();i.synthetic=false;await a.rejects(w.materialize(i),e=>e.code==='SYNTHETIC_VOCABULARY');});
test('Real CDM version concept is found by vocabulary identity 756265',async()=>{const db=new SqlDouble(),c=db.v.concepts.get(900000010);db.v.concepts.delete(900000010);db.v.concepts.set(756265,{...c,concept_id:756265,concept_code:'CDM v5.4.0'});const w=new PostgresWarehouse(config,db),b=await w.materialize(buildInput());a.equal(db.tables.get(b.schema+'.cdm_source')[0].cdm_version_concept_id,756265);});
test('Vocabulary importer consumes ten manifested TSVs and only activates after constraints',async()=>{const db=new SqlDouble(),w=new PostgresWarehouse(config,db);const dir=path.resolve(__dirname,'../../services/research/src/tests/fixtures/warehouse/vocabulary');const result=await loadVocabulary(w,dir,{licensed:false,allowSynthetic:true});a.equal(result.tables,10);a.ok(result.rows>10);a.equal(db.vocabularyStatus,'active');a.ok(db.sql.some(([q])=>q.includes('CREATE TRIGGER ahp_immutable_rows')));});
test('Unlicensed non-synthetic vocabulary manifest denied before any writes',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ahp-vocab-test-'));try{fs.cpSync(path.resolve(__dirname,'../../services/research/src/tests/fixtures/warehouse/vocabulary'),root,{recursive:true});const m=JSON.parse(fs.readFileSync(root+'/manifest.json'));m.synthetic=false;fs.writeFileSync(root+'/manifest.json',JSON.stringify(m));const db=new SqlDouble(),w=new PostgresWarehouse(config,db);await a.rejects(loadVocabulary(w,root,{licensed:false,allowSynthetic:false}),e=>e.code==='VOCABULARY_LICENSE_REQUIRED');a.equal(db.sql.filter(([q])=>q.startsWith('CREATE')).length,0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('Vocabulary hash mismatch never activates the release',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ahp-vocab-test-'));try{fs.cpSync(path.resolve(__dirname,'../../services/research/src/tests/fixtures/warehouse/vocabulary'),root,{recursive:true});fs.appendFileSync(root+'/CONCEPT.csv','\n');const db=new SqlDouble(),w=new PostgresWarehouse(config,db);await a.rejects(loadVocabulary(w,root,{licensed:false,allowSynthetic:true}),e=>e.code==='VOCABULARY_HASH_MISMATCH');a.equal(db.vocabularyStatus,'failed');}finally{fs.rmSync(root,{recursive:true,force:true});}});
