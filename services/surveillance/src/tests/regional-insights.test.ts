import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { getRegionalInsights, importAreas, publishMonth } from '../services/regional-insights.service.js';
import { getConditions, getTrends } from '../services/surveillance.service.js';
import { completedMonth, protectCells, reportFromReleases, validateTree, type Area } from '../services/regional-insights.policy.js';
const target=assertIsolatedLocalTestTarget();
const admin={sub:randomUUID(),role:'platform_admin'};
const area=(code:string,level:Area['level'],parentCode:string|null):Area=>({code,name:'Synthetic '+code,level,parentCode,latitude:null,longitude:null});
const areas=[area('C','country',null),area('R','region','C'),area('D','district','R'),area('W','ward','D'),area('V1','village','W'),area('V2','village','W')];
let clinicianId:string;
async function note(patientId:string, codes:string[], period='2026-08', threadId?:string) {
  const thread=threadId??(await prisma.careThread.create({data:{patientProfileId:patientId}})).id;
  const c=await prisma.consultationRequest.create({data:{careThreadId:thread,patientProfileId:patientId,assignedClinicianId:clinicianId,channel:'app',modality:'chat',urgencyLevel:'routine',triageRuleVersion:'synthetic',status:'completed',slaDeadlineAt:new Date()}});
  await prisma.consultationNote.create({data:{consultationId:c.id,careThreadId:thread,diagnosisText:'PRIVATE TEST NOTE NEVER RELEASE',diagnosisCodes:codes,adviceText:'private',signedByClinicianId:clinicianId,signedAt:new Date(period+'-15T12:00:00Z')}});
  return thread;
}
before(async()=>{
  await verifyLocalTestIdentity(prisma,target);
  await prisma.user.create({data:{id:admin.sub,phoneNumber:'+255700000001',email:'insights-admin@test.local',role:'platform_admin',status:'active',fullName:'Synthetic insights admin'}});
  const doctor=await prisma.user.create({data:{phoneNumber:'+255700000002',email:'insights-doctor@test.local',role:'clinician',status:'active',fullName:'Synthetic doctor'}});
  clinicianId=(await prisma.clinicianProfile.create({data:{userId:doctor.id,licenseNumber:'TEST-'+randomUUID(),specialty:'general_practice',verificationStatus:'verified'}})).id;
});
after(async()=>{await prisma.$disconnect();});
describe('protected regional releases',()=>{
  it('rejects unprivileged and revoked administrators',async()=>{
    for(const role of ['patient','clinician','lab_technician','researcher','facility_admin','pharmacist','dispatcher']) {
      await assert.rejects(()=>getRegionalInsights({sub:admin.sub,role},{}),{code:'ROLE_NOT_PERMITTED'});
      await assert.rejects(()=>publishMonth({sub:admin.sub,role},'2026-08'),{code:'ROLE_NOT_PERMITTED'});
    }
    const inactive=await prisma.user.create({data:{phoneNumber:'+255700000003',role:'platform_admin',status:'suspended',fullName:'Synthetic suspended'}});
    await assert.rejects(()=>getRegionalInsights({sub:inactive.id,role:'platform_admin'},{}),{code:'ROLE_NOT_PERMITTED'});
  });
  it('validates the entire hierarchy; imports in any order; refuses edits and invalid centroids',async()=>{
    const input={source:'Synthetic isolated test catalogue',administrative_centroids_confirmed:true as const,areas:[...areas].reverse().map(a=>({code:a.code,name:a.name,level:a.level,parent_code:a.parentCode,latitude:a.latitude,longitude:a.longitude}))};
    assert.equal((await importAreas(admin,input)).added,6);
    assert.equal((await importAreas(admin,input)).added,0);
    await assert.rejects(()=>importAreas(admin,{...input,areas:[{...input.areas[0],name:'Changed'}]}),{code:'VERSION_CONFLICT'});
    await assert.rejects(()=>importAreas(admin,{...input,areas:[{code:'BROKEN',name:'Broken',level:'village',parent_code:'R',latitude:null,longitude:null}]}),{code:'VALIDATION_FAILED'});
    await assert.rejects(()=>importAreas(admin,{...input,areas:[{...input.areas[0],latitude:91}]}));
    assert.throws(()=>validateTree([area('X','ward',null)]));
  });
  it('uses distinct patients, deduplicates diagnosis codes, hides small cells and never releases free text',async()=>{
    for(let i=0;i<10;i++) {
      const p=await prisma.patientProfile.create({data:{fullName:'SECRET-PATIENT-'+i,reportingAreaCode:'V1'}});
      await note(p.id,['B50','B50']);
    }
    for(let i=0;i<2;i++) {
      const p=await prisma.patientProfile.create({data:{fullName:'PRIVATE SMALL CELL',reportingAreaCode:'V2'}});
      await note(p.id,['B50']);
    }
    const repeated=await prisma.patientProfile.create({data:{fullName:'PRIVATE REPEAT',reportingAreaCode:'V2'}});
    await prisma.researchCodeMapping.create({data:{system:'ICD10',sourceCode:'B50',domain:'condition',conceptId:1,standardConcept:true,vocabularyVersion:'synthetic',label:'Synthetic verified diagnosis',createdBy:admin.sub}});
    let thread:string|undefined;
    for(let i=0;i<12;i++)thread=await note(repeated.id,['J00'],'2026-08',thread);
    const published=await publishMonth(admin,'2026-08');assert.equal(published.alreadyPublished,false);
    const report=await getRegionalInsights(admin,{level:'village'});
    assert.equal(report.totalCases,10);assert.equal(report.distribution.find(a=>a.code==='V1')?.cases,10);
    assert.equal(report.distribution.find(a=>a.code==='V2')?.cases,null);
    assert.deepEqual(report.conditions,['B50']);
    assert.equal(report.diseases[0].name,'Synthetic verified diagnosis');
    const json=JSON.stringify(report);for(const secret of ['SECRET-PATIENT','PRIVATE','diagnosisText','patientId','participants','J00'])assert.ok(!json.includes(secret));
    const parent=await getRegionalInsights(admin,{level:'country'});assert.equal(parent.totalCases,10);assert.equal(parent.distribution[0].cases,10);
    assert.equal((await getRegionalInsights(admin,{level:'village',area:'V2'})).totalCases,null);
  });
  it('freezes published months against late data and concurrent re-publication',async()=>{
    const p=await prisma.patientProfile.create({data:{fullName:'Late synthetic patient',reportingAreaCode:'V1'}});await note(p.id,['B50']);
    const results=await Promise.all([publishMonth(admin,'2026-08'),publishMonth(admin,'2026-08')]);assert.ok(results.every(r=>r.alreadyPublished));
    assert.equal((await getRegionalInsights(admin,{})).totalCases,10);
    const newMonth=await Promise.all([publishMonth(admin,'2026-07'),publishMonth(admin,'2026-07')]);
    assert.equal(newMonth.filter(r=>!r.alreadyPublished).length,1);
    await assert.rejects(()=>publishMonth(admin,new Date().toISOString().slice(0,7)),{code:'VALIDATION_FAILED'});
  });
  it('legacy surveillance reads only the same protected cells, never raw daily rollups',async()=>{
    await prisma.surveillanceRollup.create({data:{level:'region',areaCode:'R',conditionCode:'PRIVATE-RARE',conditionName:'Should not escape',periodStart:new Date('2026-08-01'),periodEnd:new Date('2026-08-02'),count:2}});
    const result=await getConditions(admin,{level:'region',area_code:'R'});assert.deepEqual(result.data.map(d=>[d.condition_code,d.count]),[['B50',10]]);
    const trend=await getTrends(admin,{level:'region',area_code:'R',condition_code:'B50'});assert.equal(trend.points.at(-1)?.count,10);assert.equal(trend.points[0].count,null);
  });
  it('retains recorded region codes without inventing country or coordinates',async()=>{
    for(let i=0;i<10;i++){const p=await prisma.patientProfile.create({data:{fullName:'Synthetic legacy geography',regionCode:'DAR'}});await note(p.id,['B50'],'2026-09');}
    await publishMonth(admin,'2026-09');
    const report=await getRegionalInsights(admin,{from:'2026-09',to:'2026-09',level:'region'});
    const legacy=report.distribution.find(a=>a.code==='recorded-region:DAR');
    assert.equal(legacy?.cases,10);assert.equal(legacy?.parentCode,null);assert.equal(legacy?.latitude,null);
  });
  it('does not turn gaps or withheld groups into zeroes',()=>{
    const cells=protectCells([{areaCode:'V1',conditionCode:'B50',cases:10,participants:10},{areaCode:'V2',conditionCode:'B50',cases:90,participants:1}]);
    assert.equal(cells.length,1);
    const report=reportFromReleases(['2026-01','2026-03'].map(period=>({period,publishedAt:new Date(),payload:{version:1,areas,cells}})),{level:'region'});
    assert.deepEqual(report.trend.map(p=>p.cases),[10,null,10]);
    assert.throws(()=>completedMonth('2026-13'));
  });
  it('reports disease changes and leading diseases within the selected region or district',()=>{
    const releases=['2026-08','2026-09'].map((period,i)=>({period,publishedAt:new Date(),payload:{version:1 as const,areas,labels:{B50:'Synthetic disease A',J00:'Synthetic disease B'},cells:[
      {areaCode:'V1',conditionCode:'B50',cases:i?30:20},
      {areaCode:'V1',conditionCode:'J00',cases:i?10:20},
      {areaCode:'V2',conditionCode:'B50',cases:i?20:10},
    ]}}));
    const report=reportFromReleases(releases,{level:'district',area:'R'});
    const rising=report.diseases.find(d=>d.code==='B50')!;
    assert.deepEqual([rising.latestCases,rising.previousCases,rising.changeCases,rising.changePercent,rising.direction],[50,30,20,66.7,'rising']);
    assert.deepEqual(rising.series.map(p=>p.cases),[30,50]);
    assert.equal(report.diseases.find(d=>d.code==='J00')?.direction,'falling');
    assert.deepEqual(report.distribution[0].leadingDisease,{code:'B50',name:'Synthetic disease A',cases:50});
    const village=reportFromReleases(releases,{level:'village',area:'V1',condition:'B50'});
    assert.equal(village.diseases.length,1);assert.equal(village.diseases[0].latestCases,30);assert.equal(village.diseases[0].changePercent,50);
    const district=reportFromReleases(releases,{level:'ward',area:'D'});
    assert.equal(district.diseases[0].latestCases,50);
  });
  it('never infers a disease increase from suppressed cells, absent months or a single month',()=>{
    const release=(period:string,cases:number)=>({period,publishedAt:new Date(),payload:{version:1 as const,areas,cells:[{areaCode:'V1',conditionCode:'B50',cases}]}});
    const gap=reportFromReleases([release('2026-07',20),release('2026-09',30)],{level:'region'});
    assert.equal(gap.diseaseComparison.previousPeriod,'2026-08');assert.equal(gap.diseases[0].changePercent,null);assert.equal(gap.diseases[0].direction,'unavailable');
    assert.deepEqual(gap.diseases[0].series.map(p=>p.cases),[20,null,30]);
    const single=reportFromReleases([release('2026-09',30)],{level:'region'});assert.equal(single.diseases[0].changeCases,null);
    const withheld={period:'2026-09',publishedAt:new Date(),payload:{version:1 as const,areas,cells:protectCells([{areaCode:'V1',conditionCode:'B50',cases:9,participants:9}])}};
    const report=reportFromReleases([release('2026-08',20),withheld],{level:'region'});
    assert.equal(report.diseases[0].latestCases,null);assert.equal(report.diseases[0].changeCases,null);assert.equal(report.distribution[0].leadingDisease,null);
  });
});
