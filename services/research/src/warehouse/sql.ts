import { TABLES, TABLE_MAP, type TableSpec } from './catalog.js';
import { check } from '../portal/policy.js';
export interface SqlDb {
  $executeRawUnsafe(query:string,...values:unknown[]):Promise<number>;
  $queryRawUnsafe<T=unknown>(query:string,...values:unknown[]):Promise<T>;
}
export interface SqlClient extends SqlDb {
  $transaction<T>(fn:(tx:SqlDb)=>Promise<T>,options?:{timeout?:number;maxWait?:number}):Promise<T>;
  $disconnect():Promise<void>;
}
export function identifier(value:string):string {
  check(/^[a-z][a-z0-9_]{0,62}$/.test(value),422,'INVALID_IDENTIFIER','Invalid warehouse identifier.');
  return '"'+value+'"';
}
export function schemaName(value:string):string {
  check(/^ahp_(?:omop|vocab)_[a-f0-9]{24,32}$/.test(value),422,'INVALID_WAREHOUSE_SCHEMA','Unrecognized warehouse schema.');
  return identifier(value);
}
export function columnSql(c:TableSpec['columns'][number]):string {
  const types:Record<string,string>={integer:'INTEGER',numeric:'NUMERIC',date:'DATE',timestamp:'TIMESTAMP',text:'TEXT',varchar:`VARCHAR(${c.length??1})`};
  return `${identifier(c.name)} ${types[c.type]}${c.required?' NOT NULL':''}`;
}
function parameterType(c:TableSpec['columns'][number]):string {
  const types:Record<string,string>={integer:'INTEGER',numeric:'NUMERIC',date:'DATE',timestamp:'TIMESTAMP',text:'TEXT',varchar:`VARCHAR(${c.length??1})`};
  return types[c.type];
}
export function createStatements(schema:string, vocabularySchema?:string):string[] {
  const s=schemaName(schema),out=[`CREATE SCHEMA ${s}`,`REVOKE ALL ON SCHEMA ${s} FROM PUBLIC`];
  for(const table of TABLES){
    if(vocabularySchema&&table.vocabulary)out.push(`CREATE VIEW ${s}.${identifier(table.name)} AS SELECT * FROM ${schemaName(vocabularySchema)}.${identifier(table.name)}`);
    else out.push(`CREATE TABLE ${s}.${identifier(table.name)} (${table.columns.map(columnSql).join(', ')})`);
  }
  for(const table of TABLES)if(table.primaryKey&&!(vocabularySchema&&table.vocabulary))out.push(`ALTER TABLE ${s}.${identifier(table.name)} ADD PRIMARY KEY (${identifier(table.primaryKey)})`);
  return out;
}
export function constraintStatements(schema:string,vocabularySchema?:string):string[] {
  const s=schemaName(schema),out:string[]=[];
  for(const table of TABLES){
    if(vocabularySchema&&table.vocabulary)continue;
    for(const c of table.columns)if(c.references){const [t,k]=c.references;out.push(`ALTER TABLE ${s}.${identifier(table.name)} ADD FOREIGN KEY (${identifier(c.name)}) REFERENCES ${vocabularySchema&&TABLE_MAP.get(t)?.vocabulary?schemaName(vocabularySchema):s}.${identifier(t)} (${identifier(k)}) DEFERRABLE INITIALLY DEFERRED`);}
    if(table.columns.some(c=>c.name==='person_id')&&table.name!=='person')out.push(`CREATE INDEX ON ${s}.${identifier(table.name)} (person_id)`);
    for(const col of table.columns.filter(c=>c.name.endsWith('_date')&&c.required))out.push(`CREATE INDEX ON ${s}.${identifier(table.name)} (${identifier(col.name)})`);
  }
  if(!vocabularySchema)out.push(`CREATE INDEX ON ${s}.concept (concept_code, vocabulary_id)`,`CREATE INDEX ON ${s}.concept_ancestor (descendant_concept_id)`,`CREATE INDEX ON ${s}.concept_relationship (concept_id_1, relationship_id)`);
  return out;
}
export type CdmRow=Record<string,string|number|null>;
export async function insertRows(db:SqlDb,schema:string,tableName:string,rows:CdmRow[]):Promise<void>{
  const table=TABLE_MAP.get(tableName);check(table,422,'UNKNOWN_CDM_TABLE','Unrecognized CDM table.');const s=schemaName(schema);
  const cols=table.columns;
  for(let i=0;i<rows.length;i+=100){
    const batch=rows.slice(i,i+100),values:unknown[]=[];
    const tuples=batch.map(r=>'('+cols.map(c=>{values.push(r[c.name]??null);return '$'+values.length+'::'+parameterType(c);}).join(',')+')').join(',');
    if(batch.length)await db.$executeRawUnsafe(`INSERT INTO ${s}.${identifier(tableName)} (${cols.map(c=>identifier(c.name)).join(',')}) VALUES ${tuples}`, ...values);
  }
}

/** Append-only snapshots: reject DML/TRUNCATE after loading. A database owner can
 * still alter DDL; least-privilege operations and stored hashes remain required. */
export function immutableStatements(schema:string, vocabularyOnly=false):string[]{
  const s=schemaName(schema);
  const output=[`CREATE FUNCTION ${s}.deny_snapshot_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Reviewed research snapshot is immutable'; END; $$`];
  for(const table of TABLES.filter(t=>vocabularyOnly?t.vocabulary:!t.vocabulary)){
    const target=`${s}.${identifier(table.name)}`;
    output.push(`CREATE TRIGGER ahp_immutable_rows BEFORE INSERT OR UPDATE OR DELETE ON ${target} FOR EACH STATEMENT EXECUTE FUNCTION ${s}.deny_snapshot_write()`);
    output.push(`CREATE TRIGGER ahp_immutable_truncate BEFORE TRUNCATE ON ${target} FOR EACH STATEMENT EXECUTE FUNCTION ${s}.deny_snapshot_write()`);
  }
  return output;
}
