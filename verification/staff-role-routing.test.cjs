'use strict';
/** Real roles.ts + mocked session/redirect collaborators; not NextAuth/HTTP E2E. */
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
if(!process.env.AHP_SOURCE_ROOT)throw new Error('AHP_SOURCE_ROOT is required.');
const root=fs.realpathSync(process.env.AHP_SOURCE_ROOT);
let ts;try{ts=createRequire(path.join(root,'package.json'))('typescript');}catch{ts=require('typescript');}
function load(session){
 const file=path.join(root,'apps/staff-web/lib/roles.ts'), m={exports:{}};
 const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const deps={
  'next-auth':{getServerSession:async()=>session},
  'next/navigation':{redirect:to=>{throw Object.assign(new Error('Synthetic redirect'),{destination:to});}},
  './auth':{authOptions:{}},
 };
 new vm.Script(`(function(require,module,exports){${result.outputText}\n})`,{filename:file}).runInThisContext()(s=>{
  if(!Object.hasOwn(deps,s))throw new Error('Unconfigured collaborator');return deps[s];
 },m,m.exports);return m.exports;
}
for(const [role,home] of Object.entries({clinician:'/doctor/queue',pharmacist:'/pharmacy',platform_admin:'/admin/dashboard',dispatcher:'/admin/emergency',facility_admin:'/admin/facilities',researcher:'/analytics/surveillance'})){
 test(`${role} resolves to the existing role-specific home`,()=>assert.equal(load(null).homeForRole(role),home));
}
for(const role of [undefined,null,'','unknown','patient','__proto__','constructor','toString']){
 test(`unrecognized role ${String(role)} falls back to login`,()=>assert.equal(load(null).homeForRole(role),'/login'));
}
test('unauthenticated requireRole still redirects to login',async()=>{
 await assert.rejects(load(null).requireRole(['pharmacist']),e=>e.destination==='/login');
});
test('pharmacist cannot inherit Admin route permission',async()=>{
 await assert.rejects(load({user:{role:'pharmacist'}}).requireRole(['platform_admin']),e=>e.destination==='/pharmacy');
});
test('Doctor cannot inherit pharmacy route permission',async()=>{
 await assert.rejects(load({user:{role:'clinician'}}).requireRole(['pharmacist']),e=>e.destination==='/doctor/queue');
});
test('explicitly allowed session is returned unchanged',async()=>{
 const session={user:{role:'pharmacist'}};assert.equal(await load(session).requireRole(['pharmacist']),session);
});
