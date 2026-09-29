import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { evaluateDeviation } from '../engine/deviation.js';
import * as checkins from '../services/checkin.service.js';
import * as adherence from '../services/adherence.service.js';
import { tick } from '../workers/scheduler.worker.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threads: string[] = [];
const consultationsCreated: string[] = [];
const prescriptions: string[] = [];

after(async () => {
  for (const id of prescriptions) {
    await prisma.adherenceLog.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threads) {
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

  it('auto-closes a cycle past its end date with no open deviation', async () => {
    const { cycle: c1 } = await makeCycle();
    const past = await prisma.followUpCycle.update({
      where: { id: c1.id },
      data: { endDate: new Date(Date.now() - 3600000) },
    });
    await tick();
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: past.id } });
    assert.equal(reloaded.status, 'completed');
  });

  it('does not auto-close a cycle with an open deviation', async () => {
    const { cycle } = await makeCycle();
    await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { endDate: new Date(Date.now() - 3600000), openDeviationCount: 1 },
    });
    await tick();
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
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
