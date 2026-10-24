'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('./load.cjs');
const queries=load('services/research/src/services/query.service.ts',{
 '@a-health/database':{prisma:new Proxy({},{get(){throw Error('Unexpected clinical DB access');}})},
 '@a-health/http':{forbidden:(code,message)=>Object.assign(new Error(message),{code,status:403})},
});
for(const role of ['researcher','platform_admin']){
 test('legacy unchecked query is denied before DB access: '+role,async()=>{await assert.rejects(()=>queries.submitQuery({sub:'test',role},{dataset_id:'test',ethics_approval_ref:'ANY-STRING',query:{measure:'count',group_by:['channel']}},{}),e=>e.code==='FORBIDDEN');});
 test('legacy result cannot be downloaded: '+role,async()=>{await assert.rejects(()=>queries.getQuery('old-result',{sub:'test',role}),e=>e.code==='FORBIDDEN');});
}
test('legacy queries reject patient role',async()=>{await assert.rejects(()=>queries.submitQuery({sub:'test',role:'patient'},{},{}),e=>e.code==='ROLE_NOT_PERMITTED');});
class NextResponse extends Response{constructor(b,o){super(b,o);this.cookies={set(){}};}static json(b,o={}){return new NextResponse(JSON.stringify(b),{...o,headers:{'Content-Type':'application/json',...o.headers}});}}
let authCalls=0;const routes=load('apps/staff-web/app/bff/[...path]/route.ts',{'next/server':{NextResponse},'@/lib/services':{resolveServiceUrl:()=> 'http://fixture-research'},'@/lib/serverToken':{tokenFromRequest:async()=>{authCalls++;return {accessToken:'synthetic-test-token'};}}});
function req(method,origin){return {method,nextUrl:new URL('https://staff.test.invalid/bff/research/portal/query'),headers:new Headers(origin?{origin}:{}),text:async()=>JSON.stringify({study_id:'synthetic-test'})};}
for(const origin of [undefined,'https://untrusted.test.invalid'])test('BFF denies missing/foreign Origin before forwarding: '+String(origin),async()=>{const calls=authCalls;const r=await routes.POST(req('POST',origin),{params:{path:['research','portal','query']}});assert.equal(r.status,403);assert.equal(authCalls,calls);});
test('BFF permits same origin and keeps research data non-cacheable',async()=>{const before=global.fetch;let forwarded;global.fetch=async(url,options)=>{forwarded={url,options};return new Response(JSON.stringify({data:{cells:[]}}),{status:200,headers:{'Content-Type':'application/json'}});};try{const r=await routes.POST(req('POST','https://staff.test.invalid'),{params:{path:['research','portal','query']}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(forwarded.options.headers.get('Authorization'),'Bearer synthetic-test-token');assert.deepEqual(await r.json(),{data:{cells:[]}});}finally{global.fetch=before;}});
