import { createReadStream } from 'node:fs';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { createHash } from 'node:crypto';
import { TABLES, TABLE_MAP, VOCABULARY_TABLES } from './catalog.js';
import { createStatements, constraintStatements, schemaName, insertRows, immutableStatements, type CdmRow } from './sql.js';
import { PostgresWarehouse, CONTROL } from './postgres.js';
import { check, object, keys, sha } from '../portal/policy.js';
export interface VocabularyManifest {version:string;synthetic:boolean;files:Record<string,string>}
/** Streaming TSV parser supports quoted fields, escaped quotes and embedded newlines.
 * It never evaluates SQL, macros, spreadsheets or source-controlled scripts. */
export async function* tsvRecords(chunks:AsyncIterable<string>):AsyncGenerator<string[]>{
  let row:string[]=[],cell='',quoted=false,afterQuote=false,cr=false,length=0;
  for await(const chunk of chunks)for(const ch of chunk){
    if(cr){cr=false;if(ch==='\n')continue;}
    length++;check(length<=1048576,422,'VOCABULARY_ROW_TOO_LONG','Vocabulary row exceeds the parser limit.');
    if(quoted&&!afterQuote){if(ch==='"')afterQuote=true;else cell+=ch;continue;}
    if(afterQuote&&ch==='"'){cell+='"';afterQuote=false;continue;}
    if(afterQuote){check(ch==='\t'||ch==='\r'||ch==='\n',422,'INVALID_TSV','Invalid quoted TSV field.');quoted=false;afterQuote=false;}
    if(ch==='"'&&cell===''){quoted=true;continue;}
    if(ch==='\t'){row.push(cell);cell='';continue;}
    if(ch==='\r'||ch==='\n'){row.push(cell);if(row.length>1||row[0]!=='')yield row;row=[];cell='';length=0;cr=ch==='\r';continue;}
    cell+=ch;
  }
  check(!quoted||afterQuote,422,'INVALID_TSV','Unterminated quoted TSV field.');
  if(cell!==''||row.length){row.push(cell);yield row;}
}
function value(text:string,column:{name:string;type:string;required:boolean;length?:number}):string|number|null{
  if(text===''){check(!column.required,422,'VOCABULARY_REQUIRED_FIELD','Required vocabulary field is blank.');return null;}
  if(column.type==='integer'){check(/^-?\d+$/.test(text),422,'VOCABULARY_TYPE','Invalid vocabulary integer.');const n=Number(text);check(Number.isInteger(n)&&n>=-2147483648&&n<=2147483647,422,'VOCABULARY_TYPE','Vocabulary integer out of range.');return n;}
  if(column.type==='numeric'){const n=Number(text);check(Number.isFinite(n),422,'VOCABULARY_TYPE','Invalid numeric value.');return n;}
  if(column.type==='date'){const s=/^\d{8}$/.test(text)?`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6)}`:text;const d=new Date(s+'T00:00:00Z');check(/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s,422,'VOCABULARY_DATE','Invalid vocabulary date.');return s;}
  check(text.length<=(column.length??10000)&&!text.includes('\0'),422,'VOCABULARY_TYPE',`Invalid or oversized vocabulary field: ${column.name}.`);return text;
}
export async function loadVocabulary(warehouse:PostgresWarehouse,directory:string,options:{licensed:boolean;allowSynthetic:boolean;progress?:(table:string,rows:number)=>void}):Promise<{id:string;version:string;tables:number;rows:number;hash:string}>{
  await warehouse.verifyIdentity();
  const root=await realpath(directory),manifestFile=join(root,'manifest.json');check(!(await lstat(manifestFile)).isSymbolicLink(),422,'UNSAFE_VOCABULARY_PATH','Manifest must not be a symlink.');
  const raw=object(JSON.parse(await readFile(manifestFile,'utf8')));keys(raw,['version','synthetic','files']);
  check(typeof raw.version==='string'&&/^[A-Za-z0-9_. -]{1,20}$/.test(raw.version)&&typeof raw.synthetic==='boolean',422,'INVALID_VOCABULARY_MANIFEST','A version and synthetic flag are required.');
  check(raw.synthetic?options.allowSynthetic:options.licensed,403,'VOCABULARY_LICENSE_REQUIRED','Confirm vocabulary licensing, or explicitly authorize synthetic test fixtures.');
  check(!raw.synthetic||process.env.NODE_ENV!=='production',403,'SYNTHETIC_VOCABULARY','Synthetic vocabularies are forbidden in production.');
  const files=object(raw.files);keys(files,VOCABULARY_TABLES.map(t=>t.toUpperCase()+'.csv'));
  check(Object.keys(files).length===VOCABULARY_TABLES.length,422,'VOCABULARY_FILES_REQUIRED','All ten Athena vocabulary files must be present, including empty tables.');
  for(const name of Object.keys(files)){
    const path=join(root,name),info=await lstat(path);check(info.isFile()&&!info.isSymbolicLink(),422,'UNSAFE_VOCABULARY_PATH','Only regular vocabulary files are accepted.');const actual=await realpath(path),rel=relative(root,actual);check(!isAbsolute(rel)&&!rel.startsWith('..'+sep)&&rel!=='..',422,'UNSAFE_VOCABULARY_PATH','Vocabulary file escaped its directory.');
    check(typeof files[name]==='string'&&/^[a-f0-9]{64}$/.test(String(files[name])),422,'VOCABULARY_HASH_REQUIRED','Every vocabulary file needs a SHA-256 digest.');
  }
  const digest=sha(JSON.stringify(Object.entries(files).sort())+raw.version+raw.synthetic),id=digest.slice(0,32),schema='ahp_vocab_'+id,db=warehouse.client();
  const existing=await db.$queryRawUnsafe<Array<{status:string;content_hash:string;manifest:{row_count?:number}}>>(`SELECT status,content_hash,manifest FROM ${CONTROL}.vocabulary_release WHERE id=$1`,id);
  if(existing.length){check(existing[0].status==='active'&&existing[0].content_hash===digest,409,'VOCABULARY_IMPORT_EXISTS','This vocabulary import exists but is not active. Inspect it rather than overwriting.');return {id,version:raw.version,tables:10,rows:existing[0].manifest.row_count??0,hash:digest};}
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(726342,3)');
    for(const stmt of createStatements(schema))await tx.$executeRawUnsafe(stmt);
    await tx.$executeRawUnsafe(`INSERT INTO ${CONTROL}.vocabulary_release(id,schema_name,version,synthetic,content_hash,status,manifest) VALUES($1,$2,$3,$4,$5,'loading',$6::jsonb)`,id,schema,raw.version,raw.synthetic,digest,JSON.stringify(raw));
  },{maxWait:10000,timeout:60000});
  let total=0;
  try{
    for(const tableName of VOCABULARY_TABLES){
      const table=TABLE_MAP.get(tableName)!,filename=tableName.toUpperCase()+'.csv',hasher=createHash('sha256'),stream=createReadStream(join(root,filename),{encoding:'utf8'});let header:string[]|null=null,batch:CdmRow[]=[],rows=0;
      async function* chunks(){for await(const chunk of stream){hasher.update(String(chunk),'utf8');yield String(chunk);}}
      for await(const fields of tsvRecords(chunks())){
        if(!header){header=fields.map((c,i)=>(i===0?c.replace(/^\uFEFF/,''):c).toLowerCase());check(header.length===table.columns.length&&new Set(header).size===header.length&&table.columns.every(c=>header!.includes(c.name)),422,'VOCABULARY_HEADER','Vocabulary header does not match OMOP 5.4.');continue;}
        check(fields.length===header.length,422,'VOCABULARY_COLUMN_COUNT','Vocabulary row has an invalid number of fields.');
        const row:CdmRow={};for(let i=0;i<header.length;i++)row[header[i]]=value(fields[i],table.columns.find(c=>c.name===header![i])!);batch.push(row);rows++;
        if(batch.length>=200){await insertRows(db,schema,tableName,batch);batch=[];}
      }
      check(header,422,'VOCABULARY_HEADER','A vocabulary file has no header.');if(batch.length)await insertRows(db,schema,tableName,batch);
      check(hasher.digest('hex')===files[filename],409,'VOCABULARY_HASH_MISMATCH','Vocabulary input changed or failed its SHA-256 manifest.');total+=rows;options.progress?.(tableName,rows);
    }
    const count=await db.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT count(*) AS count FROM ${schemaName(schema)}.concept WHERE concept_id=0 OR (vocabulary_id='CDM' AND invalid_reason IS NULL AND (concept_id=756265 OR concept_code IN ('5.4','5.4.0','OMOP CDM 5.4','CDM v5.4.0')))`);check(Number(count[0]?.count)>=2,422,'VOCABULARY_CORE_MISSING','Vocabulary requires the zero concept and OMOP CDM 5.4 version concept.');
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(726342,3)');
      for(const stmt of constraintStatements(schema))await tx.$executeRawUnsafe(stmt);
      for(const stmt of immutableStatements(schema,true))await tx.$executeRawUnsafe(stmt);
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName(schema)} FROM PUBLIC`);
      await tx.$executeRawUnsafe(`UPDATE ${CONTROL}.vocabulary_release SET status='retired' WHERE status='active'`);
      await tx.$executeRawUnsafe(`UPDATE ${CONTROL}.vocabulary_release SET status='active',manifest=$2::jsonb WHERE id=$1`,id,JSON.stringify({...raw,row_count:total}));
    },{maxWait:10000,timeout:300000});return {id,version:raw.version,tables:10,rows:total,hash:digest};
  }catch(e){await db.$executeRawUnsafe(`UPDATE ${CONTROL}.vocabulary_release SET status='failed' WHERE id=$1`,id);throw e;}
}
