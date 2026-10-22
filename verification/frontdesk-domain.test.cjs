'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { domain: d } = require('./lib/frontdesk-double.cjs');
const ready={checkedInAt:new Date(),administrativeAt:new Date(),triageStatus:'cleared',paymentRequired:true,insuranceRequired:true,paymentCheck:'manually_verified',insuranceCheck:'manually_verified'};
for(const key of ['checkedInAt','administrativeAt']) test('readiness fails without '+key,()=>assert.equal(d.isReadyForQueue({...ready,[key]:null}),false));
for(const triageStatus of ['pending','escalated']) test('no automatic routine admission: '+triageStatus,()=>assert.equal(d.isReadyForQueue({...ready,triageStatus}),false));
for(const key of ['paymentCheck','insuranceCheck']) test('required '+key+' cannot be waived by patient input',()=>assert.equal(d.isReadyForQueue({...ready,[key]:'not_required'}),false));
test('all explicit gates admit to waiting',()=>assert.equal(d.readinessStatus(ready),'waiting'));
test('optional check may be not_required only under policy',()=>assert.equal(d.isReadyForQueue({...ready,paymentRequired:false,insuranceRequired:false,paymentCheck:'not_required',insuranceCheck:'not_required'}),true));
test('preregistration is not physical arrival',()=>assert.equal(d.readinessStatus({...ready,checkedInAt:null}),'preregistered'));
test('arrived without review remains awaiting_review',()=>assert.equal(d.readinessStatus({...ready,administrativeAt:null}),'awaiting_review'));
const transitions={preregistered:['check-in','administrative-review','clinical-review','cancel'],awaiting_review:['administrative-review','clinical-review','cancel'],waiting:['call','cancel'],called:['start','cancel'],in_consultation:[],completed:[],cancelled:[]};
for(const [status,actions] of Object.entries(transitions)) test('state transition allowlist '+status,()=>{
 for(const action of ['check-in','administrative-review','clinical-review','call','start','cancel']) assert.equal(d.actionAllowed(status,action),actions.includes(action));
});
const departments=[{id:'dent',name:'Kinywa na meno',navigationAliases:['jino','meno','tooth']},{id:'eye',name:'Macho',navigationAliases:['eye']}];
test('jino text suggests configured dental department without diagnosis',()=>{
 const r=d.suggestDepartments('Jino langu linaniuma.',departments);assert.equal(r.suggestions[0].department_id,'dent');assert.equal(r.clinical_triage_performed,false);assert.equal(r.patient_confirmation_required,true);
});
test('unknown text does not silently route to general practice',()=>assert.equal(d.suggestDepartments('unknown symptom',departments).outcome,'manual_selection_required'));
test('multiple configured matches require selection',()=>assert.equal(d.suggestDepartments('jino na macho',departments).outcome,'multiple_matches'));
test('substring is not a directory word match',()=>assert.equal(d.suggestDepartments('jinosaurus',departments).suggestions.length,0));
test('malformed aliases do not execute or match arbitrary content',()=>assert.equal(d.suggestDepartments('foo',[{id:'x',name:'Other',navigationAliases:{malicious:'foo'}}]).suggestions.length,0));
test('directory suggestions never reveal matched input itself',()=>assert.ok(!JSON.stringify(d.suggestDepartments('my-private-narrative',departments)).includes('my-private-narrative')));
const clinician={isAvailable:true,availableUntil:null,verificationStatus:'verified',user:{role:'clinician',status:'active'}};
test('availability requires active verified currently receiving clinician',()=>assert.equal(d.clinicianReceiving(clinician,new Date()),true));
test('expired availability window is unavailable',()=>assert.equal(d.clinicianReceiving({...clinician,availableUntil:new Date(0)},new Date()),false));
test('suspended verified clinician is not receiving',()=>assert.equal(d.clinicianReceiving({...clinician,user:{role:'clinician',status:'suspended'}},new Date()),false));
test('FIFO query is scoped to facility department and requested clinician',()=>{
 const r=d.queueAheadWhere({id:'v',facilityId:'f',departmentId:'d',requestedClinicianId:'c',readyAt:new Date(0)});
 assert.equal(r.facilityId,'f');assert.equal(r.departmentId,'d');assert.equal(r.requestedClinicianId,'c');assert.equal(r.status,'waiting');assert.equal(r.OR[1].id.lt,'v');
});
