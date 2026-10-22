import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as ratings from '../services/rating.service.js';
import * as incidents from '../services/incident.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const incidentIds: string[] = [];

after(async () => {
  for (const id of incidentIds) {
    await prisma.incidentReport.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of consultationIds) {
    await prisma.consultationRating.deleteMany({ where: { consultationId: id } }).catch(() => undefined);
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
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Quality Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Quality Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Quality Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeCompletedConsultation() {
  const { user, profile } = await makePatient();
  const clinician = await makeClinician();
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  return { user, profile, clinician, consultation };
}

describe('rating', () => {
  it('rates a consultation and updates the clinician average', async () => {
    const { user, clinician, consultation } = await makeCompletedConsultation();
    const result = await ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 5 }, meta);
    assert.equal(result.score, 5);

    const reloaded = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: clinician.id } });
    assert.equal(Number(reloaded.ratingAvg), 5);
  });

  it('refuses to rate the same consultation twice', async () => {
    const { user, consultation } = await makeCompletedConsultation();
    await ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 4 }, meta);

    await assert.rejects(
      () => ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 2 }, meta),
      (e: AppError) => e.code === 'ALREADY_RATED',
    );
  });

  it('refuses a stranger rating someone else\u2019s consultation', async () => {
    const { consultation } = await makeCompletedConsultation();
    await assert.rejects(
      () => ratings.rateConsultation(consultation.id, { sub: randomUUID(), role: 'patient' }, { score: 3 }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses to rate an assigned consultation before it is completed', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
    threadIds.push(thread.id);
    const consultation = await prisma.consultationRequest.create({
      data: {
        careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
        channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
        status: 'pending', slaDeadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    consultationIds.push(consultation.id);

    await assert.rejects(
      () => ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 5 }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('averages correctly across multiple clinicians\u2019 ratings', async () => {
    const first = await makeCompletedConsultation();
    const clinician = first.clinician;
    await ratings.rateConsultation(first.consultation.id, { sub: first.user.id, role: 'patient' }, { score: 4 }, meta);

    const { user: user2, profile: profile2 } = await makePatient();
    const thread2 = await prisma.careThread.create({ data: { patientProfileId: profile2.id } });
    threadIds.push(thread2.id);
    const consultation2 = await prisma.consultationRequest.create({
      data: {
        careThreadId: thread2.id, patientProfileId: profile2.id, assignedClinicianId: clinician.id,
        channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
        status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    consultationIds.push(consultation2.id);
    await ratings.rateConsultation(consultation2.id, { sub: user2.id, role: 'patient' }, { score: 2 }, meta);

    const reloaded = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: clinician.id } });
    assert.equal(Number(reloaded.ratingAvg), 3);
  });
});

describe('incident reports', () => {
  it('records who reported when not anonymous', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'clinical_care', description: 'Was kept waiting far past the SLA.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.anonymous, false);

    const row = await prisma.incidentReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.reportedByUserId, user.id);
  });

  it('never stores the reporter when anonymous', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'misconduct', description: 'Reporting anonymously.', anonymous: true }, meta,
    );
    incidentIds.push(report.id);

    const row = await prisma.incidentReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.reportedByUserId, null);
  });

  it('escalates serious and catastrophic reports to governance', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'medication_error', severity: 'serious', description: 'Wrong dosage dispensed.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.escalated_to_governance, true);
  });

  it('does not escalate a low-severity report', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'other', severity: 'low', description: 'Minor UI confusion.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.escalated_to_governance, false);
  });

  it('refuses listing to a non-admin', async () => {
    await assert.rejects(
      () => incidents.listIncidentReports({ sub: randomUUID(), role: 'patient' }, { limit: 10 }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('lets governance list reports, most urgent first', async () => {
    const { user } = await makePatient();
    await incidents.createIncidentReport({ sub: user.id, role: 'patient' }, { category: 'other', severity: 'low', description: 'a' }, meta)
      .then((r) => incidentIds.push(r.id));
    await incidents.createIncidentReport({ sub: user.id, role: 'patient' }, { category: 'misconduct', severity: 'catastrophic', description: 'b' }, meta)
      .then((r) => incidentIds.push(r.id));

    const result = await incidents.listIncidentReports({ sub: randomUUID(), role: 'platform_admin' }, { limit: 10 });
    assert.ok(result.data.length >= 2);
    const first = result.data[0] as { escalated_to_governance: boolean };
    assert.equal(first.escalated_to_governance, true);
  });
});
