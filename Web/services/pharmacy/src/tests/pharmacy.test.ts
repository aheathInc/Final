import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as pharmacies from '../services/pharmacy.service.js';
import * as dispensing from '../services/dispensing.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const pharmacyIds: string[] = [];
const prescriptionIds: string[] = [];
const threadIds: string[] = [];

after(async () => {
  for (const id of prescriptionIds) {
    await prisma.dispensingItem.deleteMany({ where: { dispensing: { prescriptionId: id } } }).catch(() => undefined);
    await prisma.dispensingRecord.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.dispenseCode.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
  }
  // Deleted only now: Prescription and DispensingRecord/DispenseCode rows
  // are gone at this point, so the cascade from CareThread to
  // ConsultationRequest is no longer blocked, and this is what frees the
  // clinician held by the Restrict FK below.
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of pharmacyIds) {
    await prisma.pharmacyStock.deleteMany({ where: { pharmacyId: id } }).catch(() => undefined);
    await prisma.pharmacy.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Pharmacy Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Pharmacy Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Prescriber Test' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makePharmacist() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'pharmacist', status: 'active', fullName: 'Pharmacist Test' },
  });
  users.push(user.id);
  return user;
}

async function makePharmacy(overrides: { isVerified?: boolean } = {}) {
  const pharmacy = await prisma.pharmacy.create({
    data: {
      name: 'Test Pharmacy', licenseNumber: `PH-${randomUUID().slice(0, 12)}`,
      isVerified: overrides.isVerified ?? true, lat: -6.8, lng: 39.28,
    },
  });
  pharmacyIds.push(pharmacy.id);
  return pharmacy;
}

async function makePrescription() {
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
  const prescription = await prisma.prescription.create({
    data: {
      careThreadId: thread.id, consultationId: consultation.id, patientProfileId: profile.id,
      prescribedById: clinician.id,
      items: { create: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 2, durationDays: 5 }] },
    },
    include: { items: true },
  });
  prescriptionIds.push(prescription.id);
  return { prescription, user, clinician };
}

describe('medication search', () => {
  it('only returns verified pharmacies', async () => {
    const verified = await makePharmacy({ isVerified: true });
    const unverified = await makePharmacy({ isVerified: false });
    await prisma.pharmacyStock.create({ data: { pharmacyId: verified.id, medicationName: 'Paracetamol', stockStatus: 'in_stock' } });
    await prisma.pharmacyStock.create({ data: { pharmacyId: unverified.id, medicationName: 'Paracetamol', stockStatus: 'in_stock' } });

    const result = await pharmacies.searchMedication({ medication_name: 'Paracetamol', lat: -6.8, lng: 39.28, radius_km: 20 });
    const names = result.data.map((r) => r.pharmacy.id);
    assert.ok(names.includes(verified.id));
    assert.ok(!names.includes(unverified.id));
  });

  it('excludes pharmacies outside the radius', async () => {
    const near = await makePharmacy();
    await prisma.pharmacyStock.create({ data: { pharmacyId: near.id, medicationName: 'Ibuprofen', stockStatus: 'in_stock' } });
    const far = await makePharmacy();
    await prisma.pharmacy.update({ where: { id: far.id }, data: { lat: -8.9, lng: 33.4 } });
    await prisma.pharmacyStock.create({ data: { pharmacyId: far.id, medicationName: 'Ibuprofen', stockStatus: 'in_stock' } });

    const result = await pharmacies.searchMedication({ medication_name: 'Ibuprofen', lat: -6.8, lng: 39.28, radius_km: 20 });
    const ids = result.data.map((r) => r.pharmacy.id);
    assert.ok(ids.includes(near.id));
    assert.ok(!ids.includes(far.id));
  });

  it('includes the age of the stock report', async () => {
    const pharmacy = await makePharmacy();
    await prisma.pharmacyStock.create({ data: { pharmacyId: pharmacy.id, medicationName: 'Metformin', stockStatus: 'low_stock' } });
    const result = await pharmacies.searchMedication({ medication_name: 'Metformin', lat: -6.8, lng: 39.28 });
    assert.ok(result.data[0]!.last_reported_at);
  });
});

describe('dispense codes', () => {
  it('refuses to issue a code for an inactive prescription', async () => {
    const { prescription, user } = await makePrescription();
    await prisma.prescription.update({ where: { id: prescription.id }, data: { status: 'discontinued' } });

    await assert.rejects(
      () => dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta),
      (e: AppError) => e.code === 'PRESCRIPTION_NOT_ACTIVE',
    );
  });

  it('refuses a stranger issuing a code', async () => {
    const { prescription } = await makePrescription();
    await assert.rejects(
      () => dispensing.issueDispenseCode(prescription.id, { sub: randomUUID(), role: 'patient' }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('issues a code and never stores it in the clear', async () => {
    const { prescription, user } = await makePrescription();
    const result = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    assert.match(result.code, /^\d{6}$/);

    const row = await prisma.dispenseCode.findFirstOrThrow({ where: { prescriptionId: prescription.id } });
    assert.notEqual(row.codeHash, result.code);
  });

  it('redeems a code and returns a view with no diagnosis field', async () => {
    const { prescription, user } = await makePrescription();
    const pharmacist = await makePharmacist();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    const pharmacy = await makePharmacy();

    const view = await dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' });
    assert.equal(view.prescription_id, prescription.id);
    assert.equal(view.items.length, 1);
    assert.ok(!('diagnosis' in view));
    assert.ok(!('diagnosis_text' in view));
  });

  it('refuses a second redemption of the same code', async () => {
    const { prescription, user } = await makePrescription();
    const pharmacist = await makePharmacist();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    const pharmacy = await makePharmacy();
    await dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' });

    await assert.rejects(
      () => dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }),
      (e: AppError) => e.code === 'DISPENSE_CODE_INVALID',
    );
  });

  it('refuses redemption by a non-pharmacist', async () => {
    const { prescription, user } = await makePrescription();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);

    await assert.rejects(
      () => dispensing.verifyDispenseCode(issued.code, randomUUID(), { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses an unknown code', async () => {
    const pharmacist = await makePharmacist();
    await assert.rejects(
      () => dispensing.verifyDispenseCode('000000', randomUUID(), { sub: pharmacist.id, role: 'pharmacist' }),
      (e: AppError) => e.code === 'DISPENSE_CODE_INVALID',
    );
  });
});

describe('completing dispensing', () => {
  it('records dispensed quantities and marks complete', async () => {
    const { prescription, user } = await makePrescription();
    const pharmacist = await makePharmacist();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    const pharmacy = await makePharmacy();
    const view = await dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' });

    const result = await dispensing.completeDispensing(
      view.dispensing_id, { sub: pharmacist.id, role: 'pharmacist' },
      [{ prescription_item_id: view.items[0]!.id, quantity_dispensed: 10 }],
    );
    assert.equal(result.status, 'complete');
  });

  it('refuses a substitution with no approver', async () => {
    const { prescription, user } = await makePrescription();
    const pharmacist = await makePharmacist();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    const pharmacy = await makePharmacy();
    const view = await dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' });

    await assert.rejects(
      () => dispensing.completeDispensing(
        view.dispensing_id, { sub: pharmacist.id, role: 'pharmacist' },
        [{ prescription_item_id: view.items[0]!.id, quantity_dispensed: 10, substituted_with: 'Generic Amoxicillin' }],
      ),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('accepts a substitution with an approver', async () => {
    const { prescription, user, clinician } = await makePrescription();
    const pharmacist = await makePharmacist();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: user.id, role: 'patient' }, meta);
    const pharmacy = await makePharmacy();
    const view = await dispensing.verifyDispenseCode(issued.code, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' });

    const result = await dispensing.completeDispensing(
      view.dispensing_id, { sub: pharmacist.id, role: 'pharmacist' },
      [{ prescription_item_id: view.items[0]!.id, quantity_dispensed: 10, substituted_with: 'Generic Amoxicillin', substitution_approved_by: clinician.id }],
    );
    assert.equal(result.status, 'complete');
  });
});
