import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { ResearchPortal } from '../portal/service.js';
import { researchStore } from '../portal/prisma-store.js';
import { PortalError } from '../portal/policy.js';
import type { Actor, PortalConfig } from '../portal/types.js';

// Explicit opt-in. The operator provisions and migrates a disposable schema first.
// This file never creates/drops schemas, starts databases, or migrates a target.
const enabled=process.env.AHP_RESEARCH_DB_TESTS==='1';
describe('governed research Prisma repository', {skip:!enabled}, ()=>{
  let portal:ResearchPortal;
  let researcher:Actor;
  let admin:Actor;
  let outsider:Actor;
  let target:ReturnType<typeof assertIsolatedLocalTestTarget>;
  const config:PortalConfig={enabled:true,realDataEnabled:false,encryptionKey:randomBytes(32),linkageKey:randomBytes(32)};
  before(async()=>{
    target=assertIsolatedLocalTestTarget();
    await verifyLocalTestIdentity(prisma,target);
    assert.equal(await prisma.researchCollection.count(),0,'Use a fresh disposable research test schema.');
    const create=async(role:'researcher'|'platform_admin')=>{
      const u=await prisma.user.create({data:{phoneNumber:`+2557${randomInt(10_000_000,99_999_999)}`,email:`${randomUUID()}@test.invalid`,fullName:'Synthetic research test',role,status:'active'}});
      return {sub:u.id,role};
    };
    researcher=await create('researcher');admin=await create('platform_admin');outsider=await create('researcher');
    // Scanner double is confined to this opt-in DB test; production requires clamd.
    portal=new ResearchPortal(researchStore,config,async()=>'clean');
  });
  after(async()=>{await prisma.$disconnect();});
  it('persists an independent application and audit metadata',async()=>{
    const response=await portal.run(researcher,'profile.submit',{kind:'independent',display_name:'Synthetic researcher',credential_reference:'TEST-ONLY-REFERENCE'}) as {id:string};
    const stored=await prisma.researcherApplication.findUniqueOrThrow({where:{id:response.id}});
    assert.equal(stored.userId,researcher.sub);assert.equal(stored.status,'pending');
    assert.ok(await prisma.auditLog.findFirst({where:{actorUserId:researcher.sub,action:'research.portal.identity_submitted',entityId:stored.id}}));
    const outsiderData=await portal.run(outsider,'bootstrap') as {applications:unknown[]};
    assert.equal(outsiderData.applications.length,0);
  });
  it('cannot bypass identity evidence by reviewing an application without documents',async()=>{
    const row=await prisma.researcherApplication.findUniqueOrThrow({where:{userId:researcher.sub}});
    await assert.rejects(()=>portal.run(admin,'profile.review',{id:row.id,base_version:row.version,decision:'verified',identity_checked:true,note:'Synthetic test review'}), (e:unknown)=>e instanceof PortalError&&e.code==='EVIDENCE_REQUIRED');
    assert.equal((await prisma.researcherApplication.findUniqueOrThrow({where:{id:row.id}})).status,'pending');
  });
  it('serializes concurrent unique dataset creation',async()=>{
    const name=`Synthetic-${randomUUID()}`;
    const request={name,description:'Disposable research test dataset only',domains:['condition'],minimum_cell_size:10,synthetic_only:true};
    const outcomes=await Promise.allSettled([portal.run(admin,'collection.create',request),portal.run(admin,'collection.create',request)]);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
    assert.equal(await prisma.researchCollection.count({where:{name}}),1);
  });
  it('rolls back a repository write when the transaction callback throws',async()=>{
    const id=randomUUID();const now=new Date();
    await assert.rejects(()=>researchStore.transaction(async tx=>{
      await tx.insert('collection',{id,version:1,createdAt:now,updatedAt:now,name:`Rollback-${id}`,description:'Synthetic rollback fixture',domains:['condition'],minimumCellSize:10,syntheticOnly:true,status:'draft',latestReleaseId:null,createdBy:admin.sub});
      throw new Error('Intentional test failure');
    }),/Intentional test failure/);
    assert.equal(await prisma.researchCollection.findUnique({where:{id}}),null);
  });
  it('rechecks live account status even with an existing actor claim',async()=>{
    await prisma.user.update({where:{id:outsider.sub},data:{status:'suspended'}});
    await assert.rejects(()=>portal.run(outsider,'bootstrap'),(e:unknown)=>e instanceof PortalError&&e.status===403);
  });
});
