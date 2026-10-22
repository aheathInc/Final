'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./lib/frontdesk-double.cjs');
const code=(expected)=>error=>{assert.equal(error.code,expected);return true;};

test('new full patient-to-department-to-clinician workflow creates one linked consultation',async()=>{
 const h=harness(); let v=await h.waiting();assert.equal(v.status,'waiting');
 v=await h.service.callVisit(h.doc,v.id,v.version,{});assert.equal(v.status,'called');
 v=await h.service.startVisit(h.doc,v.id,v.version,{});assert.equal(v.status,'in_consultation');assert.ok(v.consultation_id);assert.ok(v.care_thread_id);
 assert.equal(h.state.consultationRequest.length,1);assert.equal(h.state.careThread.length,1);assert.equal(h.state.consultationRequest[0].patientProfileId,h.patient.id);
 assert.equal(h.state.consultationRequest[0].assignedClinicianId,h.doc.cpid);assert.equal(h.state.consultationRequest[0].triageRuleVersion,'front-desk-human-clearance-v1');
});
test('existing signed consultation completion also finishes linked visit',async()=>{
 const h=harness(); let v=await h.waiting();v=await h.service.callVisit(h.doc,v.id,v.version,{});v=await h.service.startVisit(h.doc,v.id,v.version,{});
 await h.consultations.completeConsultation(v.consultation_id,h.doc,{note:{diagnosis_text:'TEST ONLY',advice_text:'TEST ONLY'}},{});
 assert.equal(h.raw('frontDeskVisit',v.id).status,'completed');assert.equal(h.state.consultationNote.length,1);assert.ok(h.state.audits.some(a=>a.action==='frontdesk.completed'));
 const newVisit=await h.service.createVisit(h.a,h.input(),{});assert.notEqual(newVisit.id,v.id);
});
test('disabled facility fails closed',async()=>{const h=harness();h.f.digitalDeskEnabled=false;await assert.rejects(h.service.createVisit(h.a,h.input(),{}),code('FRONT_DESK_DISABLED'));});
test('urgent help request never becomes an ordinary queue ticket',async()=>{const h=harness();await assert.rejects(h.service.createVisit(h.a,h.input({urgent_help_requested:true}),{}),code('FRONT_DESK_URGENT_REVIEW'));assert.equal(h.state.frontDeskVisit.length,0);});
test('department-sharing opt-in is mandatory',async()=>{const h=harness();await assert.rejects(h.service.createVisit(h.a,h.input({share_with_department:false}),{}),code('CONSENT_REQUIRED'));});
test('patient cannot preregister unrelated patient B',async()=>{const h=harness();await assert.rejects(h.service.createVisit(h.a,h.input({patient_profile_id:h.patientB.id}),{}),code('NOT_RESOURCE_OWNER'));});
test('guardian may preregister only their expressly linked dependant',async()=>{const h=harness();h.patientB.guardianUserId=h.a.sub;const v=await h.service.createVisit(h.a,h.input({patient_profile_id:h.patientB.id}),{});assert.equal(v.patient_profile_id,h.patientB.id);});
test('wrong facility/department pair rejected',async()=>{const h=harness();await assert.rejects(h.service.createVisit(h.a,h.input({department_id:h.dB.id}),{}),code('NOT_FOUND'));});
test('wrong-facility clinician rejected',async()=>{const h=harness();await assert.rejects(h.service.createVisit(h.a,h.input({requested_clinician_id:h.outsider.cpid}),{}),code('CLINICIAN_UNAVAILABLE'));});
test('expired availability cannot be selected',async()=>{const h=harness();h.raw('clinicianProfile',h.doc.cpid).availableUntil=new Date(0);await assert.rejects(h.service.createVisit(h.a,h.input({requested_clinician_id:h.doc.cpid}),{}),code('CLINICIAN_UNAVAILABLE'));});
test('identical retried key returns same record and one audit',async()=>{const h=harness();const input=h.input();const a=await h.service.createVisit(h.a,input,{});const b=await h.service.createVisit(h.a,input,{});assert.equal(a.id,b.id);assert.equal(h.state.frontDeskVisit.length,1);assert.equal(h.state.audits.length,1);});
test('same key changed payload rejected',async()=>{const h=harness();const input=h.input();await h.service.createVisit(h.a,input,{});await assert.rejects(h.service.createVisit(h.a,{...input,purpose:'different'},{}),code('IDEMPOTENCY_KEY_CONFLICT'));});
test('new key cannot duplicate an active patient/facility visit',async()=>{const h=harness();await h.service.createVisit(h.a,h.input(),{});await assert.rejects(h.service.createVisit(h.a,h.input(),{}),code('FRONT_DESK_VISIT_EXISTS'));});
test('simulated concurrent same-key creation is idempotent',async()=>{const h=harness();const input=h.input();const [a,b]=await Promise.all([h.service.createVisit(h.a,input,{}),h.service.createVisit(h.a,input,{})]);assert.equal(a.id,b.id);});
test('arrival declaration alone does not admit to clinical queue',async()=>{const h=harness();let v=await h.service.createVisit(h.a,h.input(),{});v=await h.service.checkInVisit(h.a,v.id,v.version,{});assert.equal(v.status,'awaiting_review');});
test('payment/insurance checks remain pending even when policy says optional until admin review',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});assert.equal(v.clearance.payment,'pending');assert.equal(v.clearance.insurance,'pending');});
test('patient cannot record administrative clearance',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});await assert.rejects(h.service.administrativeReview(h.a,v.id,{base_version:v.version,registration_confirmed:true,payment_check:'not_required',insurance_check:'not_required'},{}),code('ROLE_NOT_PERMITTED'));});
test('clinician does not inherit administrator payment clearance permission',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});await assert.rejects(h.service.administrativeReview(h.doc,v.id,{base_version:v.version,registration_confirmed:true,payment_check:'not_required',insurance_check:'not_required'},{}),code('ROLE_NOT_PERMITTED'));});
test('required insurance/payment cannot be waived or confirmed without external manual references',async()=>{
 const h=harness();h.f.deskPaymentRequired=true;h.f.deskInsuranceRequired=true;const v=await h.service.createVisit(h.a,h.input(),{});
 const input={base_version:v.version,registration_confirmed:true,payment_check:'not_required',insurance_check:'not_required'};
 await assert.rejects(h.service.administrativeReview(h.admin,v.id,input,{}),code('VALIDATION_FAILED'));
 await assert.rejects(h.service.administrativeReview(h.admin,v.id,{...input,payment_check:'manually_verified',insurance_check:'manually_verified'},{}),code('VALIDATION_FAILED'));
 const cleared=await h.service.administrativeReview(h.admin,v.id,{...input,payment_check:'manually_verified',insurance_check:'manually_verified',payment_reference:'TEST-LOCAL-RECEIPT',insurance_reference:'TEST-LOCAL-REVIEW'},{});
 assert.equal(cleared.clearance.payment,'manually_verified');assert.equal(cleared.status,'preregistered');assert.ok(!JSON.stringify(cleared).includes('TEST-LOCAL-RECEIPT'));
});
test('patient and platform admin cannot give clinical clearance',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});for(const actor of [h.a,h.admin])await assert.rejects(h.service.clinicalReview(actor,v.id,{base_version:v.version,decision:'cleared'},{}),code('ROLE_NOT_PERMITTED'));});
test('unverified doctor is denied clinical review',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});h.raw('clinicianProfile',h.doc.cpid).verificationStatus='pending';await assert.rejects(h.service.clinicalReview(h.doc,v.id,{base_version:v.version,decision:'cleared'},{}),code('CLINICIAN_NOT_VERIFIED'));});
test('wrong department doctor cannot triage/read this queue',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});await assert.rejects(h.service.clinicalReview(h.outsider,v.id,{base_version:v.version,decision:'cleared'},{}),code('FACILITY_MEMBERSHIP_REQUIRED'));await assert.rejects(h.service.listStaffVisits(h.outsider,{facility_id:h.f.id,limit:20},{}),code('FACILITY_MEMBERSHIP_REQUIRED'));});
test('escalation remains outside routine queue despite administrative clearance',async()=>{const h=harness();let v=await h.service.createVisit(h.a,h.input(),{});v=await h.service.checkInVisit(h.a,v.id,v.version,{});v=await h.service.administrativeReview(h.admin,v.id,{base_version:v.version,registration_confirmed:true,payment_check:'not_required',insurance_check:'not_required'},{});v=await h.service.clinicalReview(h.doc,v.id,{base_version:v.version,decision:'escalated'},{});assert.equal(v.status,'awaiting_review');await assert.rejects(h.service.callVisit(h.doc,v.id,v.version,{}),code('STATE_TRANSITION_INVALID'));});
test('stale-version mutation is rejected',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});await h.service.checkInVisit(h.a,v.id,v.version,{});await assert.rejects(h.service.checkInVisit(h.a,v.id,v.version,{}),code('VERSION_CONFLICT'));});
test('requested doctor cannot be silently replaced by department colleague',async()=>{const h=harness();const v=await h.waiting(h.a,{requested_clinician_id:h.doc.cpid});await assert.rejects(h.service.callVisit(h.doc2,v.id,v.version,{}),code('FACILITY_MEMBERSHIP_REQUIRED'));});
test('competing call requests have one winner in serialized transaction simulation',async()=>{const h=harness();const v=await h.waiting();const results=await Promise.allSettled([h.service.callVisit(h.doc,v.id,v.version,{}),h.service.callVisit(h.doc2,v.id,v.version,{})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});
test('one clinician cannot call two hospital patients simultaneously',async()=>{const h=harness();const a=await h.waiting();const b=await h.waiting(h.b);await h.service.callVisit(h.doc,a.id,a.version,{});await assert.rejects(h.service.callVisit(h.doc,b.id,b.version,{}),code('CLINICIAN_UNAVAILABLE'));});
test('start cannot create duplicate consultation on retry',async()=>{const h=harness();let v=await h.waiting();v=await h.service.callVisit(h.doc,v.id,v.version,{});await h.service.startVisit(h.doc,v.id,v.version,{});await assert.rejects(h.service.startVisit(h.doc,v.id,v.version,{}),code('VERSION_CONFLICT'));assert.equal(h.state.consultationRequest.length,1);});
test('patient cannot start own clinical encounter',async()=>{const h=harness();let v=await h.waiting();v=await h.service.callVisit(h.doc,v.id,v.version,{});await assert.rejects(h.service.startVisit(h.a,v.id,v.version,{}),code('ROLE_NOT_PERMITTED'));});
test('Patient B cannot read or cancel Patient A visit',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});await assert.rejects(h.service.getVisit(h.b,v.id,{}),code('NOT_RESOURCE_OWNER'));await assert.rejects(h.service.cancelVisit(h.b,v.id,v.version,{}),code('NOT_RESOURCE_OWNER'));const list=await h.service.listMyVisits(h.b,{limit:20});assert.equal(list.data.length,0);});
test('staff projection omits private purpose for administrative review',async()=>{const h=harness();await h.service.createVisit(h.a,h.input(),{});const admin=await h.service.listStaffVisits(h.admin,{facility_id:h.f.id,limit:20},{});assert.equal(admin.data[0].purpose,undefined);const doctor=await h.service.listStaffVisits(h.doc,{facility_id:h.f.id,limit:20},{});assert.ok(doctor.data[0].purpose);});
test('queue position ignores different hospital and requested-clinician pool',async()=>{
 const h=harness();const a=await h.waiting(h.a,{requested_clinician_id:h.doc.cpid});const b=await h.waiting(h.b,{requested_clinician_id:h.doc2.cpid});
 const detail=await h.service.getVisit(h.b,b.id,{});assert.equal(detail.ahead_of_you,0);assert.equal(detail.estimated_wait_minutes,null);
 assert.equal((await h.service.getVisit(h.a,a.id,{})).queue_scope,'facility_department_requested_clinician');
});
test('board contains honest aggregates and no private identities or symptoms',async()=>{
 const h=harness();await h.waiting(h.a,{requested_clinician_id:h.doc.cpid});const board=await h.service.getDepartmentBoard(h.b,h.f.id,h.d.id);
 assert.equal(board.providers.find(p=>p.id===h.doc.cpid).waiting_for_this_clinician,1);assert.equal(board.estimated_wait_minutes,null);
 for(const secret of [h.patient.id,h.patient.fullName,'TEST DATA ONLY — dental'])assert.ok(!JSON.stringify(board).includes(secret));
});
test('suspended user cannot read board with a stale active token',async()=>{const h=harness();h.raw('user',h.a.sub).status='suspended';await assert.rejects(h.service.getDepartmentBoard(h.a,h.f.id,h.d.id),code('ROLE_NOT_PERMITTED'));});
test('cancelling is durable and frees active slot without deleting history',async()=>{const h=harness();let v=await h.service.createVisit(h.a,h.input(),{});v=await h.service.cancelVisit(h.a,v.id,v.version,{});assert.equal(v.status,'cancelled');const newVisit=await h.service.createVisit(h.a,h.input(),{});assert.notEqual(v.id,newVisit.id);assert.equal(h.state.frontDeskVisit.length,2);});
test('audit failure rolls back registration in transaction simulation',async()=>{const h=harness();h.failAudit(true);await assert.rejects(h.service.createVisit(h.a,h.input(),{}),/Synthetic audit failure/);assert.equal(h.state.frontDeskVisit.length,0);});
test('audit failure at consultation-start rolls back thread consultation visit and clinician load in simulation',async()=>{
 const h=harness();let v=await h.waiting();v=await h.service.callVisit(h.doc,v.id,v.version,{});h.failAudit(true);
 await assert.rejects(h.service.startVisit(h.doc,v.id,v.version,{}),/Synthetic audit failure/);
 assert.equal(h.state.careThread.length,0);assert.equal(h.state.consultationRequest.length,0);assert.equal(h.raw('frontDeskVisit',v.id).status,'called');assert.equal(h.raw('clinicianProfile',h.doc.cpid).currentLoad,0);
});
test('audit metadata excludes purpose patient names and verification references',async()=>{
 const h=harness();await h.waiting();const serialized=JSON.stringify(h.state.audits.map(a=>a.metadata));
 for(const value of ['TEST DATA ONLY','Synthetic Patient','TEST-LOCAL-RECEIPT'])assert.ok(!serialized.includes(value));
});
test('policy and directory labels remain platform-admin-only',async()=>{
 const h=harness();await assert.rejects(h.service.configureDesk(h.doc,h.f.id,{base_version:1,enabled:true,payment_required:false,insurance_required:false},{}),code('ROLE_NOT_PERMITTED'));
 await h.service.configureDesk(h.admin,h.f.id,{base_version:1,enabled:true,payment_required:true,insurance_required:false},{});assert.equal(h.raw('facility',h.f.id).deskPaymentRequired,true);
 await h.service.configureAliases(h.admin,h.f.id,h.d.id,{base_version:1,aliases:[' Dental ','dental','JINO']},{});
 const navigation=await h.service.navigateDepartment(h.a,h.f.id,'I need dental');assert.equal(navigation.suggestions[0].department_id,h.d.id);assert.equal(navigation.clinical_triage_performed,false);
});
test('disabled facility visits remain cancellable but cannot progress',async()=>{const h=harness();const v=await h.service.createVisit(h.a,h.input(),{});h.f.digitalDeskEnabled=false;await assert.rejects(h.service.checkInVisit(h.a,v.id,v.version,{}),code('FRONT_DESK_DISABLED'));const c=await h.service.cancelVisit(h.a,v.id,v.version,{});assert.equal(c.status,'cancelled');});
