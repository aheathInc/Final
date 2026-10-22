/**
 * Digital Front Desk real PostgreSQL regression — NOT EXECUTED in Candidate 005.
 * Requires a NEW, owned, disposable local test database/schema with migrations applied.
 * Fixtures are synthetic service-level actors, NOT evidence of HTTP/JWT login.
 * No automatic migration/reset/cleanup; immutable audits and fixtures are retained.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { selectDedicatedTestSchema, assertSafetyDatabaseIdentity, type DatabaseIdentity } from './safety-test-target.js';
import type { Caller } from '../services/careThread.service.js';
import type { AppError } from '@a-health/http';

const target = selectDedicatedTestSchema(process.env, 'AHP_TEST_FRONT_DESK_SCHEMA', 'ahp_test_front_desk_');
let database: typeof import('@a-health/database');
let desk: typeof import('../front-desk/service.js');
let care: typeof import('../services/consultation.service.js');
let audit: typeof import('@a-health/http');
let events: typeof import('../events.js');
const meta = { requestId: 'SYNTHETIC-front-desk-regression' };
const db = () => database.prisma;

before(async () => {
  database = await import('@a-health/database');
  const rows = await db().$queryRaw<DatabaseIdentity[]>`
    SELECT current_database() AS database_name, current_schema()::text AS schema_name,
           (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = current_schema()) AS schema_owner,
           inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
           current_user::text AS login_role, pg_is_in_recovery() AS in_recovery`;
  assertSafetyDatabaseIdentity(target, rows[0]);
  assert.equal(await db().user.count(), 0, 'Use a fresh, isolated test schema. Existing users must not be modified.');
  assert.equal(await db().frontDeskVisit.count(), 0, 'Use a fresh front-desk test database.');
  desk = await import('../front-desk/service.js');
  care = await import('../services/consultation.service.js');
  audit = await import('@a-health/http');
  events = await import('../events.js');
});
after(async () => { await events?.bus.close(); await database?.prisma.$disconnect(); });

async function actor(role: 'patient' | 'clinician' | 'platform_admin') {
  return db().user.create({ data: {
    phoneNumber: `TEST-${randomUUID().replaceAll('-', '').slice(0, 14)}`,
    role, status: 'active', fullName: `SYNTHETIC ONLY — front desk ${role}`,
  } });
}
async function fixture(options: { enabled?: boolean; required?: boolean } = {}) {
  const adminUser = await actor('platform_admin');
  const facility = await db().facility.create({ data: {
    name: `SYNTHETIC ONLY ${randomUUID()}`, type: 'hospital',
    digitalDeskEnabled: options.enabled ?? true,
    deskPaymentRequired: options.required ?? false, deskInsuranceRequired: options.required ?? false,
  } });
  const department = await db().department.create({ data: {
    facilityId: facility.id, name: 'Huduma ya meno — SYNTHETIC', navigationAliases: ['jino', 'meno', 'tooth'],
  } });
  const patientUser = await actor('patient');
  const patient = await db().patientProfile.create({ data: { userId: patientUser.id, fullName: 'SYNTHETIC ONLY — not clinical care' } });
  const doctors = await Promise.all([1, 2].map(async () => {
    const user = await actor('clinician');
    const profile = await db().clinicianProfile.create({ data: {
      userId: user.id, facilityId: facility.id, departmentId: department.id,
      licenseNumber: `TEST-${randomUUID()}`, specialty: 'general_practice',
      verificationStatus: 'verified', isAvailable: true,
    } });
    return { user, profile, caller: { sub: user.id, role: 'clinician', cpid: profile.id } as Caller };
  }));
  return { facility, department, patient, doctors,
    patientCaller: { sub: patientUser.id, role: 'patient', ppid: patient.id } as Caller,
    adminCaller: { sub: adminUser.id, role: 'platform_admin' } as Caller,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture) {
  return { request_key: randomUUID(), facility_id: f.facility.id, department_id: f.department.id,
    purpose: 'SYNTHETIC ONLY — directory and administrative workflow', share_with_department: true as const,
    urgent_help_requested: false };
}
async function ready(f: Fixture, caller = f.patientCaller) {
  let visit = await desk.createVisit(caller, input(f), meta);
  visit = await desk.checkInVisit(caller, visit.id, visit.version, meta);
  visit = await desk.administrativeReview(f.adminCaller, visit.id, { base_version: visit.version,
    registration_confirmed: true, payment_check: 'not_required', insurance_check: 'not_required' }, meta);
  return desk.clinicalReview(f.doctors[0].caller, visit.id, { base_version: visit.version, decision: 'cleared' }, meta);
}
const hasCode = (code: string) => (error: AppError) => error.code === code;

describe('Digital Front Desk — actual PostgreSQL integration gate', { concurrency: false }, () => {
  it('rejects disabled desks, then accepts after authorized facility opt-in', async () => {
    const f = await fixture({ enabled: false });
    await assert.rejects(desk.createVisit(f.patientCaller, input(f), meta), hasCode('FRONT_DESK_DISABLED'));
    await desk.configureDesk(f.adminCaller, f.facility.id, { base_version: f.facility.version,
      enabled: true, payment_required: false, insurance_required: false }, meta);
    assert.equal((await desk.createVisit(f.patientCaller, input(f), meta)).status, 'preregistered');
  });
  it('requires arrival, administrative clearance and explicit clinical assessment', async () => {
    const f = await fixture({ required: true });
    let visit = await desk.createVisit(f.patientCaller, input(f), meta);
    visit = await desk.checkInVisit(f.patientCaller, visit.id, visit.version, meta);
    assert.equal(visit.status, 'awaiting_review');
    await assert.rejects(desk.administrativeReview(f.adminCaller, visit.id, { base_version: visit.version,
      registration_confirmed: true, payment_check: 'not_required', insurance_check: 'not_required' }, meta));
    visit = await desk.administrativeReview(f.adminCaller, visit.id, { base_version: visit.version,
      registration_confirmed: true, payment_check: 'manually_verified', insurance_check: 'manually_verified',
      payment_reference: 'SYNTHETIC-MANUAL-REVIEW', insurance_reference: 'SYNTHETIC-MANUAL-REVIEW' }, meta);
    assert.equal(visit.status, 'awaiting_review');
    visit = await desk.clinicalReview(f.doctors[0].caller, visit.id, { base_version: visit.version, decision: 'escalated' }, meta);
    assert.equal(visit.status, 'awaiting_review');
    await assert.rejects(desk.callVisit(f.doctors[0].caller, visit.id, visit.version, meta), hasCode('STATE_TRANSITION_INVALID'));
    const read = await desk.getVisit(f.patientCaller, visit.id, meta);
    assert.ok(!JSON.stringify(read).includes('SYNTHETIC-MANUAL-REVIEW'));
  });
  it('creates one durable ticket under identical concurrent retries', async () => {
    const f = await fixture(); const request = input(f);
    const result = await Promise.all([desk.createVisit(f.patientCaller, request, meta), desk.createVisit(f.patientCaller, request, meta)]);
    assert.equal(result[0].id, result[1].id);
    assert.equal(await db().frontDeskVisit.count({ where: { patientProfileId: f.patient.id } }), 1);
    assert.equal(await db().auditLog.count({ where: { entityId: result[0].id, action: 'frontdesk.preregistered' } }), 1);
  });
  it('allows only one active visit under distinct concurrent request keys', async () => {
    const f = await fixture();
    const result = await Promise.allSettled([desk.createVisit(f.patientCaller, input(f), meta), desk.createVisit(f.patientCaller, input(f), meta)]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db().frontDeskVisit.count({ where: { patientProfileId: f.patient.id } }), 1);
  });
  it('allows only one doctor to claim the same ready visit', async () => {
    const f = await fixture(); const visit = await ready(f);
    const result = await Promise.allSettled(f.doctors.map((d) => desk.callVisit(d.caller, visit.id, visit.version, meta)));
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db().auditLog.count({ where: { entityId: visit.id, action: 'frontdesk.called' } }), 1);
  });
  it('allows only one called patient per clinician even across different visit rows', async () => {
    const f = await fixture(); const first = await ready(f);
    const otherUser = await actor('patient');
    const other = await db().patientProfile.create({ data: { userId: otherUser.id, fullName: 'SYNTHETIC ONLY — second test patient' } });
    const second = await ready(f, { sub: otherUser.id, role: 'patient', ppid: other.id });
    const result = await Promise.allSettled([first, second].map((v) => desk.callVisit(f.doctors[0].caller, v.id, v.version, meta)));
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  });
  it('links existing consultation completion back to the same hospital visit', async () => {
    const f = await fixture(); let visit = await ready(f);
    visit = await desk.callVisit(f.doctors[0].caller, visit.id, visit.version, meta);
    visit = await desk.startVisit(f.doctors[0].caller, visit.id, visit.version, meta);
    assert.ok(visit.consultation_id); assert.ok(visit.care_thread_id);
    const consult = await db().consultationRequest.findUniqueOrThrow({ where: { id: visit.consultation_id } });
    assert.equal(consult.patientProfileId, f.patient.id);
    assert.equal(consult.assignedClinicianId, f.doctors[0].profile.id);
    await care.completeConsultation(consult.id, f.doctors[0].caller, { note: {
      diagnosis_text: 'SYNTHETIC TEST ONLY — NOT A CLINICAL DIAGNOSIS',
      advice_text: 'SYNTHETIC SOFTWARE REGRESSION — NOT FOR PATIENT USE',
    } }, meta);
    assert.equal((await desk.getVisit(f.patientCaller, visit.id, meta)).status, 'completed');
    assert.equal((await db().clinicianProfile.findUniqueOrThrow({ where: { id: f.doctors[0].profile.id } })).currentLoad, 0);
  });
  it('rejects non-owner read and cross-department staff writes', async () => {
    const a = await fixture(); const b = await fixture();
    const visit = await desk.createVisit(a.patientCaller, input(a), meta);
    await assert.rejects(desk.getVisit(b.patientCaller, visit.id, meta), hasCode('NOT_RESOURCE_OWNER'));
    await assert.rejects(desk.clinicalReview(b.doctors[0].caller, visit.id,
      { base_version: visit.version, decision: 'cleared' }, meta), hasCode('FACILITY_MEMBERSHIP_REQUIRED'));
  });
  it('rejects stale actions and retains one committed arrival event', async () => {
    const f = await fixture(); const visit = await desk.createVisit(f.patientCaller, input(f), meta);
    await desk.checkInVisit(f.patientCaller, visit.id, visit.version, meta);
    await assert.rejects(desk.checkInVisit(f.patientCaller, visit.id, visit.version, meta), hasCode('VERSION_CONFLICT'));
    assert.equal(await db().auditLog.count({ where: { entityId: visit.id, action: 'frontdesk.arrival_declared' } }), 1);
  });
  it('isolates queue position and directory counts between facilities', async () => {
    const a = await fixture(); const b = await fixture();
    const aVisit = await ready(a); await ready(b);
    const position = await desk.getVisit(a.patientCaller, aVisit.id, meta);
    assert.equal(position.queue_position, 1);
    const board = await desk.getDepartmentBoard(a.patientCaller, a.facility.id, a.department.id);
    assert.equal(board.department_pool_waiting, 1);
    assert.equal(board.estimated_wait_minutes, null);
    assert.equal(board.coverage, 'AHP_REGISTERED_VISITS_ONLY');
  });
  it('rejects invalid direct state writes through database CHECK constraints', async () => {
    const f = await fixture(); const visit = await desk.createVisit(f.patientCaller, input(f), meta);
    await assert.rejects(db().frontDeskVisit.update({ where: { id: visit.id }, data: { status: 'waiting' } }));
    assert.equal((await db().frontDeskVisit.findUniqueOrThrow({ where: { id: visit.id } })).status, 'preregistered');
  });
  it('verifies audit linkage and both partial unique index backstops', async () => {
    const indexes = await db().$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'front_desk_visits'
      AND indexname IN ('front_desk_one_active_patient_facility','front_desk_one_called_patient_per_clinician')`;
    assert.equal(indexes.length, 2);
    const integrity = await audit.verifyAuditChain(); assert.equal(integrity.ok, true);
  });
});
