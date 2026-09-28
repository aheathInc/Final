import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { computeRollups } from '../workers/rollup.worker.js';
import * as surveillance from '../services/surveillance.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const admin = { role: 'platform_admin' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const noteIds: string[] = [];

after(async () => {
  for (const id of noteIds) {
    await prisma.consultationNote.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.consultationRequest.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.surveillanceRollup.deleteMany({ where: { conditionCode: 'TEST-MALARIA' } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Surv Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeNotedConsultation(clinicianId: string, regionCode: string | null, diagnosisCode: string) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Surv Patient' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Surv Patient', regionCode: regionCode ?? undefined },
  });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  const note = await prisma.consultationNote.create({
    data: {
      consultationId: consultation.id, careThreadId: thread.id,
      diagnosisText: 'test', diagnosisCodes: [diagnosisCode] as never,
      adviceText: 'test', signedByClinicianId: clinicianId, signedAt: new Date(),
    },
  });
  noteIds.push(note.id);
  return { consultation, note };
}

describe('rollup worker', () => {
  it('computes national and regional counts from real diagnosis notes', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'DAR', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, 'DAR', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, null, 'TEST-MALARIA');

    await computeRollups();

    const national = await prisma.surveillanceRollup.findFirst({
      where: { level: 'national', conditionCode: 'TEST-MALARIA' },
    });
    assert.ok(national);
    assert.equal(national!.count, 3);

    const regional = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'DAR', conditionCode: 'TEST-MALARIA' },
    });
    assert.ok(regional);
    assert.equal(regional!.count, 2);
  });

  it('is idempotent \u2014 a second run for the same window does not double the count', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'ARU', 'TEST-MALARIA');

    await computeRollups();
    const firstRun = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'ARU', conditionCode: 'TEST-MALARIA' },
    });
    await computeRollups();
    const secondRun = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'ARU', conditionCode: 'TEST-MALARIA' },
    });

    assert.equal(firstRun!.count, secondRun!.count);
  });

  it('never invents a region for a patient with none on record', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, null, 'TEST-MALARIA');

    await computeRollups();

    const regionalRows = await prisma.surveillanceRollup.count({
      where: { level: 'region', conditionCode: 'TEST-MALARIA', areaCode: '' },
    });
    assert.equal(regionalRows, 0);
  });
});

describe('reading', () => {
  it('ranks conditions by count, most common first', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'MWZ', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, 'MWZ', 'TEST-MALARIA');
    await computeRollups();

    const result = await surveillance.getConditions(admin, { level: 'region', area_code: 'MWZ' });
    const entry = result.data.find((d) => d.condition_code === 'TEST-MALARIA');
    assert.ok(entry);
    assert.equal(entry!.count, 2);
  });

  it('refuses a role with no privilege to view aggregate data', async () => {
    await assert.rejects(
      () => surveillance.getConditions({ role: 'patient' }, { level: 'national' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('returns null expected bounds honestly rather than fabricating a forecast', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'DOD', 'TEST-MALARIA');
    await computeRollups();

    const result = await surveillance.getTrends(admin, { condition_code: 'TEST-MALARIA', level: 'region', area_code: 'DOD' });
    assert.ok(result.points.length > 0);
    assert.equal(result.points[0]!.expected_low, null);
    assert.equal(result.points[0]!.above_expected, false);
  });
});
