'use strict';
// Executes the actual Web BFF path resolver; not HTTP/NextAuth acceptance.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lib/load-typescript.cjs');
function withEnvironment(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map(k => [k,process.env[k]]));
  for(const [k,v] of Object.entries(values)) if(v==null) delete process.env[k]; else process.env[k]=v;
  try { return run(load('apps/staff-web/lib/services.ts')); }
  finally { for(const [k,v] of Object.entries(saved)) if(v==null) delete process.env[k]; else process.env[k]=v; }
}
for(const endpoint of ['/front-desk/facilities','/front-desk/visits','/front-desk/staff/visits','/front-desk/visits/synthetic-id/start']) {
  test(`BFF routes ${endpoint} to the Consultation owner`, () => withEnvironment({API_GATEWAY_URL:undefined,CONSULTATION_SERVICE_URL:undefined}, m => {
    assert.equal(m.resolveServiceUrl(endpoint), 'http://localhost:4005');
  }));
}
test('BFF respects explicit worktree Consultation URL',()=>withEnvironment({API_GATEWAY_URL:undefined,CONSULTATION_SERVICE_URL:'http://127.0.0.1:4505'},m=> {
  assert.equal(m.resolveServiceUrl('/front-desk/visits'), 'http://127.0.0.1:4505');
}));
test('BFF keeps configured gateway precedence',()=>withEnvironment({API_GATEWAY_URL:'https://gateway.example.invalid/api/v1'},m=> {
  assert.equal(m.resolveServiceUrl('/front-desk/visits'), 'https://gateway.example.invalid/api/v1');
}));
test('new prefix does not hijack an unrelated endpoint',()=>withEnvironment({API_GATEWAY_URL:undefined},m=> {
  assert.equal(m.resolveServiceUrl('/front-desk-unknown/visits'), null);
}));
