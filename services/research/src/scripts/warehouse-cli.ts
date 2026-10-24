import 'dotenv/config';
import { warehouseConfig } from '../warehouse/config.js';
import { PostgresWarehouse } from '../warehouse/postgres.js';
import { loadVocabulary } from '../warehouse/vocabulary.js';
import { PortalError, check } from '../portal/policy.js';
const args=process.argv.slice(2),command=args[0];
const take=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const warehouse=new PostgresWarehouse(warehouseConfig());
try{
  check(['status','init','vocabulary','work-once'].includes(command??''),422,'COMMAND_REQUIRED','Use status, init --ack-dedicated-warehouse, vocabulary --directory PATH --licensed, or work-once.');
  if(command==='status')console.log(JSON.stringify(await warehouse.status(),null,2));
  if(command==='init'){check(args.includes('--ack-dedicated-warehouse'),422,'ACK_REQUIRED','Explicit dedicated-warehouse acknowledgement required.');await warehouse.initialize();console.log('Warehouse control schema initialized. No operational schema was changed.');}
  if(command==='vocabulary'){
    const directory=take('--directory');check(directory,422,'DIRECTORY_REQUIRED','Vocabulary directory required.');
    const result=await loadVocabulary(warehouse,directory,{licensed:args.includes('--licensed'),allowSynthetic:args.includes('--synthetic')&&process.env.RESEARCH_ALLOW_SYNTHETIC_VOCABULARY==='true',progress:(t,n)=>console.log(t+': '+n+' vocabulary rows')});console.log(JSON.stringify(result,null,2));
  }
  if(command==='work-once'){const {portal,warehouse:workerWarehouse}=await import('../portal/routes.js');try{const result=await portal.processWarehouseJob();console.log(JSON.stringify(result??{status:'no_queued_jobs'}));if(result?.status==='failed')process.exitCode=1;}finally{await workerWarehouse?.close();}}
}catch(e){console.error(e instanceof PortalError?e.code+': '+e.message:'Warehouse command failed. Check protected local diagnostics; no credentials are printed.');process.exitCode=1;}
finally{await warehouse.close();const {prisma}=await import('@a-health/database');await prisma.$disconnect();}
