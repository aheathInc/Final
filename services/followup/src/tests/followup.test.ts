import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import type { AppError } from '@a-health/http';
import { evaluateDeviation } from '../engine/deviation.js';
import * as checkins from '../services/checkin.service.js';
import * as adherence from '../services/adherence.service.js';
import { tick } from '../workers/scheduler.worker.js';
import * as continuity from '../continuity/service.js';
import { reminderTick } from '../continuity/reminder.worker.js';

// This suite writes data and calls a global scheduler. Require the explicitly
// isolated local test schema; never use the acceptance/demo schema.
const testTarget = assertIsolatedLocalTestTarget(process.env);

before(async () => {
  await verifyLocalTestIdentity(prisma, testTarget);
});

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threads: string[] = [];
const consultationsCreated: string[] = [];
const prescriptions: string[] = [];

after(async () => {
  for (const id of prescriptions) {
    await prisma.careReminder.deleteMany({ where: { dose: { prescriptionId: id } } });
    await prisma.adherenceLog.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.medicationReminderPlan.deleteMany({ where: { item: { prescriptionId: id } } });
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threads) {
    await prisma.careReminder.deleteMany({ where: { checkIn: { careThreadId: id } } });
    await prisma.careContact.deleteMany({ where: { cycle: { careThreadId: id } } });
    await prisma.consultationNote.deleteMany({ where: { careThreadId: id } });
    await prisma.checkIn.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.followUpCycle.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    for (const cid of consultationsCreated) {
      await prisma.consultationRequest.deleteMany({ where: { id: cid, careThreadId: id } }).catch(() => undefined);
    }
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.notificationLog.deleteMany({ where: { userId: id } });
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: '+2557' + randomInt(10000000, 99999999), role: 'patient', status: 'active', fullName: 'Followup Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Followup Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: '+2557' + randomInt(10000000, 99999999), email: randomUUID() + '@test.local', role: 'clinician', status: 'active', fullName: 'Followup Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: 'TEST-' + randomUUID().slice(0, 12), specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeThread(patientProfileId: string) {
  const thread = await prisma.careThread.create({ data: { patientProfileId } });
  threads.push(thread.id);
  return thread;
}

async function makeConsultation(threadId: string, patientProfileId: string, clinicianId: string) {
  const c = await prisma.consultationRequest.create({
    data: {
      careThreadId: threadId, patientProfileId, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine',
      triageRuleVersion: 'test', status: 'completed',
      slaDeadlineAt: new Date(Date.now() + 3600000),
    },
  });
  consultationsCreated.push(c.id);
  return c;
}

async function makeCycle(criteria: Record<string, unknown> = {}) {
  const { profile } = await makePatient();
  const clinician = await makeClinician();
  const thread = await makeThread(profile.id);
  const consultation = await makeConsultation(thread.id, profile.id, clinician.id);
  const cycle = await prisma.followUpCycle.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, clinicianId: clinician.id,
      sourceConsultationId: consultation.id, frequency: 'daily',
      recoveryCriteria: criteria as never,
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 6 * 86400000),
    },
  });
  await prisma.careThread.update({
    where: { id: thread.id }, data: { activeFollowUpCycleId: cycle.id },
  });
  return { cycle, patient: profile, clinician, thread };
}

describe('deviation engine', () => {
  it('flags a vital outside its bound', () => {
    const r = evaluateDeviation({ systolic: 165 }, { vital_bounds: { systolic: { max: 140 } } });
    assert.equal(r.isDeviation, true);
    assert.ok(r.reasons[0]!.includes('systolic'));
  });

  it('passes a vital inside its bound', () => {
    const r = evaluateDeviation({ systolic: 120 }, { vital_bounds: { systolic: { max: 140 } } });
    assert.equal(r.isDeviation, false);
  });

  it('flags a red-flag field reported true', () => {
    const r = evaluateDeviation({ wound_discharge: true }, { red_flag_fields: ['wound_discharge'] });
    assert.equal(r.isDeviation, true);
  });

  it('skips an unrecognised criterion rather than treating it as a match', () => {
    const r = evaluateDeviation({ mood: 'fine' }, { vital_bounds: { unknown_field: { max: 1 } } } as never);
    assert.equal(r.isDeviation, false);
  });

  it('flags a concerning phrase in free text', () => {
    const r = evaluateDeviation(
      { notes: 'wound has a foul smell today' },
      { concerning_phrases: { notes: ['foul smell', 'pus'] } },
    );
    assert.equal(r.isDeviation, true);
  });
});

describe('check-in response', () => {
  it('computes is_deviation server-side, ignoring any client-supplied value', async () => {
    const { cycle, patient } = await makeCycle({ vital_bounds: { systolic: { max: 140 } } });
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });

    const result = await checkins.respondToCheckIn(
      checkIn.id,
      { sub: patient.userId!, role: 'patient' },
      { responses: { systolic: 180 } },
      meta,
    );

    assert.equal(result.is_deviation, true);
    const reloadedCycle = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloadedCycle.openDeviationCount, 1);
  });

  it('refuses to answer an already-answered check-in', async () => {
    const { cycle, patient } = await makeCycle();
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    await checkins.respondToCheckIn(checkIn.id, { sub: patient.userId!, role: 'patient' }, { responses: {} }, meta);

    await assert.rejects(
      () => checkins.respondToCheckIn(checkIn.id, { sub: patient.userId!, role: 'patient' }, { responses: {} }, meta),
      (e: AppError) => e.code === 'CHECK_IN_ALREADY_ANSWERED',
    );
  });

  it('refuses a stranger', async () => {
    const { cycle } = await makeCycle();
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    await assert.rejects(
      () => checkins.respondToCheckIn(checkIn.id, { sub: randomUUID(), role: 'patient' }, { responses: {} }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('cycle closing', () => {
  it('marks remaining scheduled check-ins as missed', async () => {
    const { cycle, clinician } = await makeCycle();
    await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(Date.now() + 86400000), questions: [] },
    });

    await checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta);

    const remaining = await prisma.checkIn.findMany({ where: { followUpCycleId: cycle.id } });
    assert.ok(remaining.every((c) => c.status === 'missed'));
  });

  it('refuses to close an already-closed cycle', async () => {
    const { cycle, clinician } = await makeCycle();
    await checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta);

    await assert.rejects(
      () => checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta),
      (e: AppError) => e.code === 'FOLLOW_UP_CYCLE_CLOSED',
    );
  });
});

describe('scheduler', () => {
  it('creates due check-ins for an active cycle', async () => {
    const { cycle } = await makeCycle();
    const before = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    await tick();
    const after = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    assert.ok(after > before);
  });

  it('is idempotent - a second tick creates no duplicates', async () => {
    const { cycle } = await makeCycle();
    await tick();
    const afterFirst = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    await tick();
    const afterSecond = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    assert.equal(afterFirst, afterSecond);
  });

  it('leaves an ended, unanswered cycle active with no inferred outcome', async () => {
    const { cycle, thread } = await makeCycle();
    const now = new Date('2031-01-02T12:00:00Z');
    const beforeTick = await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { startDate: new Date('2030-12-01'), endDate: new Date('2031-01-01') },
    });
    await prisma.checkIn.create({
      data: {
        followUpCycleId: cycle.id, careThreadId: thread.id,
        scheduledAt: new Date('2030-12-31T08:00:00Z'), questions: [],
      },
    });
    const result = await tick(now);
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    const currentThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(reloaded.status, 'active');
    assert.equal(reloaded.outcome, null);
    assert.equal(reloaded.version, beforeTick.version);
    assert.equal(currentThread.activeFollowUpCycleId, cycle.id);
    assert.equal(result.cyclesAutoClosed, 0);
    assert.equal(await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } }), 1);
  });

  it('does not infer recovery from normal responses after the window ends', async () => {
    const { cycle, thread } = await makeCycle();
    const now = new Date('2031-01-02T12:00:00Z');
    await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { startDate: new Date('2030-12-01'), endDate: new Date('2031-01-01') },
    });
    await prisma.checkIn.create({
      data: {
        followUpCycleId: cycle.id, careThreadId: thread.id,
        scheduledAt: new Date('2030-12-31T08:00:00Z'), questions: [],
        status: 'responded', responses: { synthetic_check: 'acknowledged' },
        isDeviation: false, respondedAt: new Date('2030-12-31T08:01:00Z'),
      },
    });
    await tick(now);
    await tick(now);
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
    assert.equal(reloaded.outcome, null);
    const currentThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(currentThread.activeFollowUpCycleId, cycle.id);
  });

  it('keeps an ended cycle with an unresolved deviation active', async () => {
    const { cycle, thread } = await makeCycle();
    await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { startDate: new Date('2030-12-01'), endDate: new Date('2031-01-01'), openDeviationCount: 1 },
    });
    await tick(new Date('2031-01-02T12:00:00Z'));
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
    assert.equal(reloaded.outcome, null);
    const currentThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(currentThread.activeFollowUpCycleId, cycle.id);
  });

  it('allows the assigned clinician to explicitly close an ended cycle', async () => {
    const { cycle, clinician, thread } = await makeCycle();
    await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { startDate: new Date('2030-12-01'), endDate: new Date('2031-01-01') },
    });
    await tick(new Date('2031-01-02T12:00:00Z'));
    await checkins.closeCycle(
      cycle.id, { sub: clinician.userId, role: 'clinician', cpid: clinician.id },
      'recovered', 'Synthetic explicit-close regression only', meta,
    );
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    const currentThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(reloaded.status, 'completed');
    assert.equal(reloaded.outcome, 'recovered');
    assert.equal(currentThread.activeFollowUpCycleId, null);
  });

  it('marks a long-overdue check-in as missed', async () => {
    const { cycle } = await makeCycle();
    const old = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(Date.now() - 48 * 3600000), questions: [] },
    });
    await tick();
    const reloaded = await prisma.checkIn.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(reloaded.status, 'missed');
  });
});

describe('adherence', () => {
  async function makePrescriptionWithDoses(count: number) {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await makeThread(profile.id);
    const consultation = await makeConsultation(thread.id, profile.id, clinician.id);
    const prescription = await prisma.prescription.create({
      data: {
        careThreadId: thread.id, consultationId: consultation.id, patientProfileId: profile.id,
        prescribedById: clinician.id,
        items: { create: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 1, durationDays: count }] },
      },
      include: { items: true },
    });
    prescriptions.push(prescription.id);

    const item = prescription.items[0]!;
    const logs = [];
    for (let i = 0; i < count; i += 1) {
      logs.push(await prisma.adherenceLog.create({
        data: {
          prescriptionItemId: item.id, prescriptionId: prescription.id, patientProfileId: profile.id,
          medicationName: item.medicationName, dosage: item.dosage,
          scheduledAt: new Date(Date.now() - (count - i) * 86400000),
        },
      }));
    }
    return { profile, clinician, prescription, logs };
  }

  it('confirms a dose as taken', async () => {
    const { profile, logs } = await makePrescriptionWithDoses(1);
    const result = await adherence.confirmDose(
      logs[0]!.id, { sub: profile.userId!, role: 'patient' },
      { reported_status: 'taken' }, 3, meta,
    );
    assert.equal(result.reported_status, 'taken');
  });

  it('refuses a stranger confirming a dose', async () => {
    const { logs } = await makePrescriptionWithDoses(1);
    await assert.rejects(
      () => adherence.confirmDose(logs[0]!.id, { sub: randomUUID(), role: 'patient' }, { reported_status: 'taken' }, 3, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lets the assigned clinician read adherence for their care thread', async () => {
    const { profile, clinician, logs } = await makePrescriptionWithDoses(1);
    const result = await adherence.listAdherence(
      { sub: clinician.userId, role: 'clinician', cpid: clinician.id },
      { patient_profile_id: profile.id, limit: 20 },
    );
    assert.deepEqual((result.data as { id: string }[]).map((entry) => entry.id), [logs[0]!.id]);
  });

  it('does not let an unrelated clinician read adherence', async () => {
    const { profile, logs } = await makePrescriptionWithDoses(1);
    const unrelated = await makeClinician();
    await assert.rejects(
      () => adherence.listAdherence(
        { sub: unrelated.userId, role: 'clinician', cpid: unrelated.id },
        { patient_profile_id: profile.id, limit: 20 },
      ),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
    assert.equal(logs.length, 1);
  });

  it('raises an audit entry after consecutive missed doses', async () => {
    const { profile, logs } = await makePrescriptionWithDoses(3);
    for (const log of logs) {
      await adherence.confirmDose(log.id, { sub: profile.userId!, role: 'patient' }, { reported_status: 'missed' }, 3, meta);
    }
    const entries = await prisma.auditLog.count({ where: { action: 'adherence.repeated_missed_doses', entityId: logs[2]!.id } });
    assert.equal(entries, 1);
  });
});


// Candidate 004: DB-backed regressions. These require the verified isolated
// isolated local test target checked above; they are not offline/mock tests.
describe('follow-up single-writer integrity', () => {
  it('accepts one concurrent answer and counts one deviation', async () => {
    const { cycle, patient } = await makeCycle({ red_flag_fields: ['synthetic_attention'] });
    const row = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
      checkins.respondToCheckIn(row.id, { sub: patient.userId!, role: 'patient' },
        { responses: { synthetic_attention: true } }, meta),
    ));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    for (const r of results) {
      if (r.status === 'rejected') assert.equal((r.reason as AppError).code, 'CHECK_IN_ALREADY_ANSWERED');
    }
    const persisted = await prisma.checkIn.findUniqueOrThrow({ where: { id: row.id } });
    const reloadedCycle = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(persisted.status, 'responded');
    assert.equal(persisted.version, row.version + 1);
    assert.equal(reloadedCycle.openDeviationCount, 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: row.id, action: 'checkin.deviation_flagged' } }), 1);
  });

  it('keeps clinical deviation values out of ledger metadata', async () => {
    const { cycle, patient } = await makeCycle({ vital_bounds: { synthetic_metric: { max: 10 } } });
    const row = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    const response = await checkins.respondToCheckIn(row.id, { sub: patient.userId!, role: 'patient' },
      { responses: { synthetic_metric: 1234567 } }, meta);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: row.id, action: 'checkin.deviation_flagged' } });
    assert.ok(JSON.stringify(response.deviation_reasons).includes('1234567'));
    assert.deepEqual(audit.metadata, { cycleId: cycle.id, reasonCount: 1 });
    assert.ok(!JSON.stringify(audit.metadata).includes('1234567'));
  });

  it('accepts an authorized late answer without reopening a clinical outcome', async () => {
    const { cycle, patient } = await makeCycle();
    const row = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), status: 'missed', questions: [] },
    });
    const result = await checkins.respondToCheckIn(row.id, { sub: patient.userId!, role: 'patient' }, { responses: {} }, meta);
    assert.equal(result.status, 'responded');
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
    assert.equal(reloaded.outcome, null);
  });

  it('persists one explicit outcome for competing closures', async () => {
    const { cycle, clinician, thread } = await makeCycle();
    const caller = { sub: clinician.userId, role: 'clinician', cpid: clinician.id };
    const results = await Promise.allSettled([
      checkins.closeCycle(cycle.id, caller, 'recovered', undefined, meta),
      checkins.closeCycle(cycle.id, caller, 'escalated', undefined, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal((failure.reason as AppError).code, 'FOLLOW_UP_CYCLE_CLOSED');
    const success = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof checkins.closeCycle>>>;
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.outcome, success.value.outcome);
    assert.equal(reloaded.version, cycle.version + 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: cycle.id, action: 'followup.cycle_closed' } }), 1);
    assert.equal((await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } })).activeFollowUpCycleId, null);
  });

  it('does not mutate a cycle or write a success audit for a forbidden closure', async () => {
    const { cycle, patient, thread } = await makeCycle();
    await assert.rejects(
      () => checkins.closeCycle(cycle.id, { sub: patient.userId!, role: 'patient' }, 'recovered', undefined, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
    assert.equal(reloaded.outcome, null);
    assert.equal((await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } })).activeFollowUpCycleId, cycle.id);
    assert.equal(await prisma.auditLog.count({ where: { entityId: cycle.id, action: 'followup.cycle_closed' } }), 0);
  });
});


describe('follow-up response/closure lock ordering', () => {
  it('can complete an allowed late response and explicit closure without contradictory row updates', async () => {
    const { cycle, patient, clinician } = await makeCycle({ red_flag_fields: ['synthetic_attention'] });
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    const results = await Promise.allSettled([
      checkins.respondToCheckIn(checkIn.id, { sub: patient.userId!, role: 'patient' },
        { responses: { synthetic_attention: true } }, meta),
      checkins.closeCycle(cycle.id, { sub: clinician.userId, role: 'clinician', cpid: clinician.id },
        'escalated', undefined, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    const persisted = await prisma.checkIn.findUniqueOrThrow({ where: { id: checkIn.id } });
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(persisted.status, 'responded');
    assert.equal(reloaded.outcome, 'escalated');
    assert.equal(reloaded.openDeviationCount, 1);
  });
});


// Candidate 006 database regressions. Executable only on the explicitly verified
// isolated local test target above. Synthetic records, never clinical orders.
describe('care continuity persistence and concurrency', () => {
  async function fixture() {
    const f = await makeCycle();
    await prisma.consultationNote.create({ data: { consultationId: f.cycle.sourceConsultationId,
      careThreadId: f.thread.id, diagnosisText: 'TEST DATA ONLY — NOT CLINICAL', adviceText: 'TEST ONLY',
      signedByClinicianId: f.clinician.id, signedAt: new Date() } });
    const prescription = await prisma.prescription.create({ data: { careThreadId: f.thread.id,
      consultationId: f.cycle.sourceConsultationId, patientProfileId: f.patient.id, prescribedById: f.clinician.id,
      items: { create: { medicationName: 'TEST CONTINUITY ITEM', dosage: 'TEST', frequencyPerDay: 2, durationDays: 2 } } }, include: { items: true } });
    prescriptions.push(prescription.id);
    const caller = { sub: f.clinician.userId, cpid: f.clinician.id, role: 'clinician' };
    const owner = { sub: f.patient.userId!, ppid: f.patient.id, role: 'patient' };
    const now = new Date(); const day = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
    const input = { base_version: 0, start_date: day, timezone: 'Africa/Dar_es_Salaam', times: ['08:00', '20:00'] };
    return { ...f, prescription, item: prescription.items[0]!, caller, owner, input, now };
  }
  it('persists clinician-agreed times and preserves them on read-back', async () => {
    const f = await fixture(); const p = await continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now);
    const row = await prisma.medicationReminderPlan.findUniqueOrThrow({ where: { id: p.id } });
    assert.deepEqual(row.times, ['08:00', '20:00']); assert.equal(row.timezone, 'Africa/Dar_es_Salaam');
    assert.equal(await prisma.adherenceLog.count({ where: { reminderPlanId: p.id, supersededAt: null } }), 4);
  });
  it('concurrent initial schedule writers have exactly one winner', async () => {
    const f = await fixture(); const attempts = await Promise.allSettled([
      continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now),
      continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now),
    ]);
    assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
    assert.equal(await prisma.adherenceLog.count({ where: { prescriptionItemId: f.item.id, supersededAt: null } }), 4);
  });
  it('replaces only unreported slots and retains superseded history', async () => {
    const f = await fixture(); const p = await continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now);
    await continuity.saveSchedule(f.item.id, f.caller, { ...f.input, base_version: p.version, times: ['09:00', '21:00'] }, meta, f.now);
    assert.equal(await prisma.adherenceLog.count({ where: { prescriptionItemId: f.item.id } }), 8);
    assert.equal(await prisma.adherenceLog.count({ where: { prescriptionItemId: f.item.id, supersededAt: null } }), 4);
  });
  it('repeat reminder ticks cannot duplicate the same persisted dose reminder', async () => {
    const f = await fixture(); const p = await continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now);
    const d = await prisma.adherenceLog.findFirstOrThrow({ where: { reminderPlanId: p.id }, orderBy: { scheduledAt: 'asc' } });
    const due = new Date(d.scheduledAt.getTime() + 1000);
    await Promise.all([reminderTick(due), reminderTick(due)]);
    assert.equal(await prisma.careReminder.count({ where: { adherenceLogId: d.id } }), 1);
    assert.equal((await prisma.adherenceLog.findUniqueOrThrow({ where: { id: d.id } })).reportedStatus, 'unreported');
  });
  it('SMS remains opt-in and queued content has no medicine payload', async () => {
    const f = await fixture(); const p = await continuity.saveSchedule(f.item.id, f.caller, f.input, meta, f.now);
    await continuity.updatePreference(f.owner, f.patient.id, { sms_enabled: true, base_version: 0 }, meta);
    const d = await prisma.adherenceLog.findFirstOrThrow({ where: { reminderPlanId: p.id }, orderBy: { scheduledAt: 'asc' } });
    await reminderTick(new Date(d.scheduledAt.getTime() + 1000));
    const r = await prisma.careReminder.findUniqueOrThrow({ where: { adherenceLogId: d.id }, include: { notification: true } });
    assert.equal(r.notification?.templateKey, 'care.dose_due'); assert.deepEqual(r.notification?.payload, {});
  });
  it('patient B cannot read or change patient A reminder preferences', async () => {
    const f = await fixture(); const b = await makePatient(); const caller = { sub: b.user.id, role: 'patient' };
    await assert.rejects(() => continuity.patientOverview(caller, { patient_profile_id: f.patient.id, limit: 30 }), (e: AppError) => e.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(() => continuity.updatePreference(caller, f.patient.id, { sms_enabled: true, base_version: 0 }, meta), (e: AppError) => e.code === 'NOT_RESOURCE_OWNER');
  });
  it('concurrent contact retries create one appointment and no call', async () => {
    const f = await fixture(); const input = { request_key: randomUUID(), scheduled_at: new Date(Date.now() + 3600000).toISOString(), channel: 'phone', purpose: 'TEST ONLY — care contact' };
    const [a,b] = await Promise.all([continuity.scheduleContact(f.cycle.id, f.caller, input, meta), continuity.scheduleContact(f.cycle.id, f.caller, input, meta)]);
    assert.equal(a.id, b.id); assert.equal(a.status, 'scheduled'); assert.equal(a.completed_at, null);
  });
  it('only one reviewer can review the same check-in version', async () => {
    const f = await fixture(); const c = await prisma.checkIn.create({ data: { careThreadId: f.thread.id, followUpCycleId: f.cycle.id,
      scheduledAt: new Date(), questions: [], responses: { test: true }, status: 'responded', isDeviation: true } });
    const r = await Promise.allSettled([continuity.reviewCheckIn(c.id, f.caller, { base_version: c.version, note: 'TEST REVIEW' }, meta),
      continuity.reviewCheckIn(c.id, f.caller, { base_version: c.version, note: 'TEST REVIEW' }, meta)]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal((await prisma.followUpCycle.findUniqueOrThrow({ where: { id: f.cycle.id } })).openDeviationCount, 0);
  });
  it('transaction rollback leaves no partially saved reminder plan', async () => {
    const f = await fixture();
    await assert.rejects(() => prisma.$transaction(async tx => {
      await tx.medicationReminderPlan.create({ data: { prescriptionItemId: f.item.id, timezone: 'UTC', startDate: new Date(), times: ['08:00','20:00'], configuredById: f.clinician.id } });
      throw new Error('TEST ROLLBACK');
    }));
    assert.equal(await prisma.medicationReminderPlan.count({ where: { prescriptionItemId: f.item.id } }), 0);
  });
});
