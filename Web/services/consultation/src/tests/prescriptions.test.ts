import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as consultation from '../services/consultation.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const prescriptionIds: string[] = [];

after(async () => {
  for (const id of prescriptionIds) {
    await prisma.adherenceLog.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
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

async function makePrescription() {
  const patientUser = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Rx Test' },
  });
  users.push(patientUser.id);
  const profile = await prisma.patientProfile.create({ data: { userId: patientUser.id, fullName: 'Rx Test' } });

  const clinicianUser = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Rx Clinician' },
  });
  users.push(clinicianUser.id);
  const clinician = await prisma.clinicianProfile.create({
    data: { userId: clinicianUser.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(clinician.id);

  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultationRow = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultationRow.id);

  const prescription = await prisma.prescription.create({
    data: {
      careThreadId: thread.id, consultationId: consultationRow.id, patientProfileId: profile.id,
      prescribedById: clinician.id,
      items: { create: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 2, durationDays: 5 }] },
    },
  });
  prescriptionIds.push(prescription.id);

  return { patientUser, profile, clinician, prescription };
}

describe('prescription reads', () => {
  it('lets the owning patient read their own prescription', async () => {
    const { patientUser, profile, prescription } = await makePrescription();
    const result = await consultation.getPrescription(prescription.id, { sub: patientUser.id, role: 'patient', ppid: profile.id });
    assert.equal(result.id, prescription.id);
    assert.equal(result.items.length, 1);
  });

  it('lets the prescribing clinician read it', async () => {
    const { clinician, prescription } = await makePrescription();
    const result = await consultation.getPrescription(prescription.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id });
    assert.equal(result.id, prescription.id);
  });

  it('refuses a stranger', async () => {
    const { prescription } = await makePrescription();
    await assert.rejects(
      () => consultation.getPrescription(prescription.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lists a patient\u2019s prescriptions', async () => {
    const { patientUser, profile } = await makePrescription();
    const result = await consultation.listPatientPrescriptions(profile.id, { sub: patientUser.id, role: 'patient', ppid: profile.id }, { limit: 25 });
    assert.equal(result.data.length, 1);
  });
});
