import { prisma, type Prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';
import type { Rows, Store, Table, Tx } from './types.js';

const delegates = {
  application:'researcherApplication',study:'researchStudy',evidence:'researchEvidence',collection:'researchCollection',
  source:'researchSourceGrant',event:'researchStagedEvent',release:'researchRelease',export:'researchExportRequest',
  form:'researchForm',response:'researchFormResponse',key:'researchAccessKey',mapping:'researchCodeMapping',throttle:'researchThrottle',omopBatch:'researchOmopBatch',omopBuild:'researchOmopBuild',responseSnapshot:'researchResponseSnapshot',output:'researchOutputRequest',
} as const;
// Narrow structural delegate avoids Prisma's incompatible generic union signatures.
// Runtime JSON has already been validated at the domain boundary; schema fields match domain rows.
interface Delegate {
  findUnique(args:{where:{id:string}}):Promise<unknown>;
  findMany(args:{where:unknown;orderBy:{createdAt:'desc'};take:number}):Promise<unknown[]>;
  create(args:{data:unknown}):Promise<unknown>;
  update(args:{where:{id:string};data:unknown}):Promise<unknown>;
}
function port(db:Prisma.TransactionClient):Tx {
  const model=(t:Table)=>(db as unknown as Record<string,Delegate>)[delegates[t]];
  return {
    get:async <K extends Table>(t:K,id:string)=>await model(t).findUnique({where:{id}}) as Rows[K]|null,
    list:async <K extends Table>(t:K,filter:Partial<Rows[K]>={},limit=100)=>await model(t).findMany({where:filter,orderBy:{createdAt:'desc'},take:Math.min(Math.max(limit,1),20001)}) as Rows[K][],
    insert:async <K extends Table>(t:K,row:Rows[K])=>await model(t).create({data:row}) as Rows[K],
    patch:async <K extends Table>(t:K,id:string,fields:Partial<Rows[K]>)=>await model(t).update({where:{id},data:fields}) as Rows[K],
    user:async id=>db.user.findUnique({where:{id},select:{id:true,role:true,status:true}}),
    facility:async id=>db.facility.findUnique({where:{id},select:{id:true,isActive:true}}),
    audit:async event=>appendAudit(event,db),
  };
}
export const researchStore:Store = {
  transaction:fn=>prisma.$transaction(async db=>{
    // One ordering for grants, revocation, release publication, ingestion and downloads.
    // Conservative serialized baseline; move to per-project locks only with concurrency tests.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(726341, 1)`;
    return fn(port(db));
  },{maxWait:10000,timeout:20000}),
};
