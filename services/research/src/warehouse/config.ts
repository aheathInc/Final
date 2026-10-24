import { check } from '../portal/policy.js';
import type { WarehouseConfig } from './types.js';
export function warehouseConfig(env:NodeJS.ProcessEnv=process.env):WarehouseConfig {
  const enabled=env.RESEARCH_WAREHOUSE_ENABLED==='true';
  if(!enabled)return {enabled:false,databaseUrl:'',expectedDatabase:'',maxRows:50000,workerEnabled:false};
  let url:URL,operational:URL;
  try{url=new URL(env.RESEARCH_WAREHOUSE_DATABASE_URL??'');operational=new URL(env.DATABASE_URL??'');}catch{throw Error('A dedicated warehouse database URL and operational DATABASE_URL are required.');}
  check(['postgres:','postgresql:'].includes(url.protocol),503,'WAREHOUSE_CONFIG_REQUIRED','PostgreSQL warehouse required.');
  const expected=env.RESEARCH_WAREHOUSE_DATABASE??'';
  check(/^[a-z][a-z0-9_]{2,60}$/.test(expected)&&url.pathname==='/'+expected,503,'WAREHOUSE_CONFIG_REQUIRED','Warehouse database identity must be explicit and literal.');
  check(url.pathname!==operational.pathname,503,'WAREHOUSE_ISOLATION_REQUIRED','Warehouse must use a different database from operational AHP.');
  check(!!url.username&&!!url.password&&url.username!=='postgres',503,'WAREHOUSE_CONFIG_REQUIRED','Use a dedicated non-superuser warehouse login.');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(local)check(url.port&&url.port!=='5432',503,'WAREHOUSE_PORT_NOT_ALLOWED','Use an explicit isolated local port, not 5432.');
  else check(url.searchParams.get('sslmode')==='verify-full',503,'WAREHOUSE_TLS_REQUIRED','Remote warehouse TLS verification is required.');
  check(!url.searchParams.get('schema')||url.searchParams.get('schema')==='public',503,'WAREHOUSE_CONFIG_REQUIRED','Warehouse schemas are selected by the service, not caller input.');
  const maxRows=Number(env.RESEARCH_WAREHOUSE_MAX_ROWS??50000);check(Number.isInteger(maxRows)&&maxRows>=100&&maxRows<=200000,503,'WAREHOUSE_CONFIG_REQUIRED','Invalid reviewed warehouse batch capacity.');
  return {enabled:true,databaseUrl:url.toString(),expectedDatabase:expected,maxRows,workerEnabled:env.RESEARCH_WAREHOUSE_WORKER_ENABLED==='true'};
}
