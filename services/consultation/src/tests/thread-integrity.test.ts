/**
 * ChangeSet 001 database regression. Real Prisma/service calls; NOT HTTP/JWT E2E.
 * Requires a fresh, operator-owned local test schema on a non-5432 loopback port.
 * Synthetic rows are deliberately retained for inspection. No reset/truncate or
 * audit deletion occurs. Dispose of the dedicated DB through the operator's
 * approved procedure after inspection; do not reuse a shared test environment.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { selectDedicatedTestSchema, assertSafetyDatabaseIdentity, type DatabaseIdentity } from './safety-test-target.js';
import type { Caller } from '../services/careThread.service.js';
import type { AppError } from '@a-health/http';

// Validate target BEFORE importing Prisma, dotenv or the application.
const target = selectDedicatedTestSchema(process.env, 'AHP_TEST_THREAD_SCHEMA', 'ahp_test_thread_integrity_');
let database: typeof import('@a-health/database') | undefined;
let service: typeof import('../services/consultation.service.js');
let events: typeof import('../events.js') | undefined;
const meta = { requestId: 'synthetic-thread-integrity-regression' };

function db() {
  assert.ok(database, 'Database bootstrap must complete before fixtures.');
  return database.prisma;
}

before(async () => {
  database = await import('@a-health/database');
  let row: DatabaseIdentity | undefined;
  try {
    const rows = await db().$queryRaw<DatabaseIdentity[]>`
      SELECT current_database() AS database_name, current_schema()::text AS schema_name,
             (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = current_schema()) AS schema_owner,
             inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
             current_user::text AS login_role, pg_is_in_recovery() AS in_recovery`;
    row = rows[0];
  } catch {
    throw new Error('Unable to verify isolated test database; fixtures were not created.');
  }
  assertSafetyDatabaseIdentity(target, row);
  // Earlier suites must have cleaned up their own patient/staff/care fixtures.
  // Schema, migration and immutable audit records may remain; patient data may not.
  assert.equal(await db().user.count(), 0, 'Use an empty dedicated test schema, not an acceptance/shared schema.');
  assert.equal(await db().careThread.count(), 0, 'Pre-existing care records are not allowed.');
  assert.equal(await db().followUpCycle.count(), 0, 'Pre-existing follow-up records are not allowed.');
  service = await import('../services/consultation.service.js');
  events = await import('../events.js');
});

after(async () => {
  await events?.bus.close();
  await database?.prisma.$disconnect();
});

async function makePatient(guardianUserId?: string) {
  const user = guardianUserId ? null : await db().user.create({ data: {
    // Deliberately not a real/reachable phone number. No delivery/Auth call here.
    phoneNumber: `TEST-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    fullName: 'SYNTHETIC ONLY — thread integrity', role: 'patient', status: 'active',
  } });
  const patient = await db().patientProfile.create({ data: {
    userId: user?.id, guardianUserId,
    fullName: 'SYNTHETIC ONLY — thread integrity', dateOfBirth: new Date('2000-01-01'),
  } });
  return { patient, user };
}

async function makeThread(patientProfileId: string, closed = false) {
  return db().careThread.create({ data: {
    patientProfileId, status: closed ? 'closed' : 'open',
    closedAt: closed ? new Date('2025-01-01T00:00:00Z') : null,
    outcome: closed ? 'recovered' : null, reasonSummary: 'SYNTHETIC ONLY — not clinical care',
  } });
}

function callerFor(p: Awaited<ReturnType<typeof makePatient>>): Caller {
  assert.ok(p.user);
  return { sub: p.user.id, role: 'patient', ppid: p.patient.id };
}

function inputFor(patientId: string, threadId: string) {
  return {
    patient_profile_id: patientId, care_thread_id: threadId,
    channel: 'app', modality: 'chat', symptom_text: 'SYNTHETIC ONLY — integrity regression',
  };
}

async function assertDeniedWithoutMutation(caller: Caller, patientId: string, threadId: string, code = 'NOT_RESOURCE_OWNER') {
  const beforeThread = await db().careThread.findUnique({ where: { id: threadId } });
  const beforeCounts = await Promise.all([
    db().consultationRequest.count(), db().changeLog.count(),
    db().auditLog.count({ where: { action: 'consultation.created', actorUserId: caller.sub } }),
  ]);
  await assert.rejects(
    service.createConsultation(caller, inputFor(patientId, threadId), meta),
    (error: AppError) => error.code === code && error.statusCode === (code === 'NOT_FOUND' ? 404 : 403),
  );
  assert.deepEqual(await db().careThread.findUnique({ where: { id: threadId } }), beforeThread,
    'A denied request must not reopen/change the foreign thread.');
  const afterCounts = await Promise.all([
    db().consultationRequest.count(), db().changeLog.count(),
    db().auditLog.count({ where: { action: 'consultation.created', actorUserId: caller.sub } }),
  ]);
  assert.deepEqual(afterCounts, beforeCounts, 'Denied association must not create consultation/change/audit success records.');
}

async function assertAccepted(caller: Caller, patientId: string, threadId: string) {
  const prior = await db().careThread.findUniqueOrThrow({ where: { id: threadId } });
  const result = await service.createConsultation(caller, inputFor(patientId, threadId), meta);
  const persisted = await db().consultationRequest.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(persisted.patientProfileId, patientId);
  assert.equal(persisted.careThreadId, threadId);
  const thread = await db().careThread.findUniqueOrThrow({ where: { id: threadId } });
  assert.equal(thread.patientProfileId, patientId);
  assert.equal(thread.status, 'open');
  assert.equal(thread.latestConsultationId, persisted.id);
  assert.equal(thread.openConsultationCount, prior.openConsultationCount + 1);
  assert.equal(await db().auditLog.count({ where: { action: 'consultation.created', entityId: persisted.id } }), 1);
  // No clinicians are created in this suite. The real async offer function is
  // not mocked; its non-clinical routing effects are not acceptance criteria.
}

describe('consultation patient/thread integrity — real database', { concurrency: false }, () => {
  it('denies a foreign open thread without persistent writes', async () => {
    const a = await makePatient(); const b = await makePatient();
    await assertDeniedWithoutMutation(callerFor(a), a.patient.id, (await makeThread(b.patient.id)).id);
  });
  it('denies a foreign closed thread without reopening it', async () => {
    const a = await makePatient(); const b = await makePatient();
    await assertDeniedWithoutMutation(callerFor(a), a.patient.id, (await makeThread(b.patient.id, true)).id);
  });
  it('does not mix two dependants even when they share a guardian', async () => {
    const guardian = await makePatient();
    const a = await makePatient(guardian.user!.id); const b = await makePatient(guardian.user!.id);
    await assertDeniedWithoutMutation(callerFor(guardian), a.patient.id, (await makeThread(b.patient.id)).id);
  });
  it('rejects mismatched associations for the existing admin caller path', async () => {
    const admin = await db().user.create({ data: {
      phoneNumber: `TEST-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      role: 'platform_admin', status: 'active', fullName: 'SYNTHETIC ONLY — integrity admin',
    } });
    const a = await makePatient(); const b = await makePatient();
    await assertDeniedWithoutMutation({ sub: admin.id, role: 'platform_admin' }, a.patient.id, (await makeThread(b.patient.id)).id);
  });
  it('preserves valid own-thread consultation creation', async () => {
    const a = await makePatient();
    await assertAccepted(callerFor(a), a.patient.id, (await makeThread(a.patient.id)).id);
  });
  it('preserves reopening an owned closed thread', async () => {
    const a = await makePatient(); const t = await makeThread(a.patient.id, true);
    await assertAccepted(callerFor(a), a.patient.id, t.id);
    const current = await db().careThread.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(current.closedAt, null); assert.equal(current.outcome, null);
  });
  it('preserves a guardian consultation on the correct dependant thread', async () => {
    const guardian = await makePatient(); const child = await makePatient(guardian.user!.id);
    await assertAccepted(callerFor(guardian), child.patient.id, (await makeThread(child.patient.id)).id);
  });
  it('rejects a nonexistent thread without persistent writes', async () => {
    const a = await makePatient();
    await assertDeniedWithoutMutation(callerFor(a), a.patient.id, randomUUID(), 'NOT_FOUND');
  });
  it('retains the existing selected-patient ownership rejection', async () => {
    const a = await makePatient(); const b = await makePatient();
    await assertDeniedWithoutMutation(callerFor(a), b.patient.id, (await makeThread(b.patient.id)).id);
  });
});
