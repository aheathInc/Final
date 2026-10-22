import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { sha256, verifyAuditChain, type AppError } from '@a-health/http';
import * as pharmacies from '../services/pharmacy.service.js';
import * as dispensing from '../services/dispensing.service.js';

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) {
  throw new Error('DATABASE_URL is required; configure the isolated local ahealth_test database before running Pharmacy tests.');
}

let databaseUrl: URL;
try {
  databaseUrl = new URL(configuredDatabaseUrl);
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL URL for the isolated local ahealth_test database.');
}

const databaseName = databaseUrl.pathname.replace(/^\//, '');
const configuredHost = databaseUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
const databasePort = Number(databaseUrl.port);
const approvedHosts = ['localhost', '127.0.0.1', '::1'];
const isLoopbackAddress = (address: string | null): boolean => {
  const normalized = (address ?? '').toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  return normalized === '::1' || normalized.split('.')[0] === '127';
};

if (
  !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
  databaseName !== 'ahealth_test' ||
  !databaseUrl.port ||
  databasePort === 5432 ||
  !approvedHosts.includes(configuredHost)
) {
  throw new Error('Pharmacy tests require DATABASE_URL to target local ahealth_test on an explicit non-5432 port.');
}

const meta = { ip: '127.0.0.1', requestId: 'smart-pharmacy-test' };
const userIds: string[] = [];
const clinicianIds: string[] = [];
const profileIds: string[] = [];
const facilityIds: string[] = [];
const pharmacyIds: string[] = [];
const prescriptionIds: string[] = [];
const threadIds: string[] = [];

before(async () => {
  let identity: { database_name: string; server_address: string | null; server_port: number } | undefined;
  try {
    const rows = await prisma.$queryRaw<Array<{
      database_name: string;
      server_address: string | null;
      server_port: number;
    }>>`SELECT current_database() AS database_name, inet_server_addr()::text AS server_address, inet_server_port() AS server_port`;
    identity = rows[0];
  } catch {
    throw new Error('Could not verify the Pharmacy test database identity; no Pharmacy tests were run.');
  }

  if (
    !identity ||
    identity.database_name !== 'ahealth_test' ||
    identity.server_port !== databasePort ||
    !isLoopbackAddress(identity.server_address)
  ) {
    throw new Error('Connected database identity did not match isolated local ahealth_test; no Pharmacy tests were run.');
  }
});

after(async () => {
  const allPrescriptionIds = [...prescriptionIds];
  if (allPrescriptionIds.length) {
    await prisma.dispensingItem.deleteMany({ where: { dispensing: { prescriptionId: { in: allPrescriptionIds } } } });
    await prisma.dispensingRecord.deleteMany({ where: { prescriptionId: { in: allPrescriptionIds } } });
    await prisma.dispenseCode.deleteMany({ where: { prescriptionId: { in: allPrescriptionIds } } });
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: allPrescriptionIds } } });
    await prisma.prescription.deleteMany({ where: { id: { in: allPrescriptionIds } } });
  }
  if (threadIds.length) await prisma.careThread.deleteMany({ where: { id: { in: threadIds } } });
  if (userIds.length) {
    await prisma.notificationLog.deleteMany({ where: { userId: { in: userIds }, templateKey: { in: ['prescription.handoff_ready', 'prescription.fulfilment_update'] } } });
    await prisma.pharmacyMembership.deleteMany({ where: { userId: { in: userIds } } });
  }
  if (pharmacyIds.length) {
    await prisma.pharmacyStock.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
    await prisma.pharmacy.deleteMany({ where: { id: { in: pharmacyIds } } });
  }
  if (clinicianIds.length) await prisma.clinicianProfile.deleteMany({ where: { id: { in: clinicianIds } } });
  if (facilityIds.length) await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
  if (profileIds.length) await prisma.patientProfile.deleteMany({ where: { id: { in: profileIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function makeUser(role: 'patient' | 'clinician' | 'pharmacist' | 'platform_admin', name: string) {
  const user = await prisma.user.create({ data: {
    phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
    email: `${randomUUID()}@test.local`, role, status: 'active', fullName: name,
  } });
  userIds.push(user.id);
  return user;
}

async function makeFacility() {
  const facility = await prisma.facility.create({ data: { name: 'TEST DATA ONLY - NOT FOR CLINICAL USE', type: 'clinic', isActive: true } });
  facilityIds.push(facility.id);
  return facility;
}

async function makePharmacy(facilityId?: string) {
  const pharmacy = await prisma.pharmacy.create({ data: {
    name: 'TEST DATA ONLY - NOT FOR CLINICAL USE',
    licenseNumber: `TEST-PH-${randomUUID().slice(0, 12)}`,
    isVerified: true, isActive: true, lat: -6.8, lng: 39.28,
    ...(facilityId ? { facilityId } : {}),
  } });
  pharmacyIds.push(pharmacy.id);
  return pharmacy;
}

async function makePharmacist(pharmacyId: string) {
  const pharmacist = await makeUser('pharmacist', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
  const verifier = await makeUser('platform_admin', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
  await prisma.pharmacyMembership.create({ data: {
    userId: pharmacist.id, pharmacyId,
    professionalLicenseNumber: `TEST-LIC-${randomUUID().slice(0, 12)}`,
    isActive: true, isVerified: true, verifiedAt: new Date(), verifiedByUserId: verifier.id,
  } });
  return pharmacist;
}

async function makePrescription(options: {
  quantity?: number | null; validUntil?: Date | null; status?: 'active' | 'completed' | 'discontinued'; signed?: boolean;
  facilityId?: string;
} = {}) {
  const patient = await makeUser('patient', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
  const profile = await prisma.patientProfile.create({ data: { userId: patient.id, fullName: 'TEST DATA ONLY - NOT FOR CLINICAL USE' } });
  profileIds.push(profile.id);
  const clinicianUser = await makeUser('clinician', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
  const clinician = await prisma.clinicianProfile.create({ data: {
    userId: clinicianUser.id, licenseNumber: `TEST-CL-${randomUUID().slice(0, 12)}`,
    specialty: 'general_practice', verificationStatus: 'verified', facilityId: options.facilityId ?? null,
  } });
  clinicianIds.push(clinician.id);
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({ data: {
    careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
    channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
    status: 'completed', completedAt: new Date(), slaDeadlineAt: new Date(Date.now() + 60_000),
  } });
  if (options.signed !== false) await prisma.consultationNote.create({ data: {
    consultationId: consultation.id, careThreadId: thread.id,
    diagnosisText: 'TEST DATA ONLY - NOT FOR CLINICAL USE', adviceText: 'TEST DATA ONLY - NOT FOR CLINICAL USE',
    signedByClinicianId: clinician.id, signedAt: new Date(),
  } });
  const prescription = await prisma.prescription.create({ data: {
    careThreadId: thread.id, consultationId: consultation.id, patientProfileId: profile.id,
    prescribedById: clinician.id, status: options.status ?? 'active',
    validUntil: options.validUntil === undefined ? new Date(Date.now() + 7 * 86400_000) : options.validUntil,
    items: { create: [{
      medicationName: 'TEST MEDICINE - NOT FOR CLINICAL USE', dosage: 'test unit',
      frequencyPerDay: 1, durationDays: 10,
      quantityPrescribed: options.quantity === undefined ? 10 : options.quantity,
    }] },
  }, include: { items: true } });
  prescriptionIds.push(prescription.id);
  return { prescription, patient, profile, clinician, clinicianUser, item: prescription.items[0]! };
}

async function putStock(pharmacyId: string, quantity: number | null, medicationName = 'TEST MEDICINE - NOT FOR CLINICAL USE') {
  return prisma.pharmacyStock.create({ data: {
    pharmacyId, medicationName, stockStatus: quantity === 0 ? 'out_of_stock' : quantity === null ? 'unknown' : 'in_stock',
    quantityOnHand: quantity,
  } });
}

describe('synthetic prescription handoff', () => {
  it('issues a high-entropy reference, stores only its hash, and rotates by revoking the old reference', async () => {
    const { prescription, patient } = await makePrescription();
    const first = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const row = await prisma.dispenseCode.findFirstOrThrow({ where: { prescriptionId: prescription.id } });
    assert.equal(first.reference.length, 43);
    assert.notEqual(row.codeHash, first.reference);
    const second = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    assert.notEqual(first.reference, second.reference);
    assert.ok(await prisma.dispenseCode.findFirst({ where: { prescriptionId: prescription.id, codeHash: row.codeHash, revokedAt: { not: null } } }));
  });

  it('fails closed for unsigned, unexpired-date-missing, unquantified, expired and discontinued prescriptions', async () => {
    const unsigned = await makePrescription({ signed: false });
    await assert.rejects(() => dispensing.issueDispenseCode(unsigned.prescription.id, { sub: unsigned.patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'PRESCRIPTION_NOT_FINALIZED');
    const noExpiry = await makePrescription({ validUntil: null });
    await assert.rejects(() => dispensing.issueDispenseCode(noExpiry.prescription.id, { sub: noExpiry.patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'VALIDATION_FAILED');
    const noQuantity = await makePrescription({ quantity: null });
    await assert.rejects(() => dispensing.issueDispenseCode(noQuantity.prescription.id, { sub: noQuantity.patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'VALIDATION_FAILED');
    const expired = await makePrescription({ validUntil: new Date(Date.now() - 1000) });
    await assert.rejects(() => dispensing.issueDispenseCode(expired.prescription.id, { sub: expired.patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'PRESCRIPTION_EXPIRED');
    const discontinued = await makePrescription({ status: 'discontinued' });
    await assert.rejects(() => dispensing.issueDispenseCode(discontinued.prescription.id, { sub: discontinued.patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'PRESCRIPTION_NOT_ACTIVE');
  });

  it('rejects non-owner issuance and patient B read-back of patient A', async () => {
    const { prescription, patient } = await makePrescription();
    const patientB = await makeUser('patient', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
    await assert.rejects(() => dispensing.issueDispenseCode(prescription.id, { sub: patientB.id, role: 'patient' }, meta), (e: AppError) => e.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(() => dispensing.getPrescriptionFulfillment(prescription.id, { sub: patientB.id, role: 'patient' }), (e: AppError) => e.code === 'NOT_RESOURCE_OWNER');
    assert.equal((await dispensing.getPrescriptionFulfillment(prescription.id, { sub: patient.id, role: 'patient' })).prescription_id, prescription.id);
  });

  it('requires an active verified pharmacist membership at the dispensing pharmacy', async () => {
    const { prescription, patient, clinicianUser } = await makePrescription();
    const pharmacy = await makePharmacy();
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const stranger = await makeUser('pharmacist', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: stranger.id, role: 'pharmacist' }, meta), (e: AppError) => e.code === 'PHARMACY_MEMBERSHIP_REQUIRED');
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: patient.id, role: 'patient' }, meta), (e: AppError) => e.code === 'ROLE_NOT_PERMITTED');
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: clinicianUser.id, role: 'clinician' }, meta), (e: AppError) => e.code === 'ROLE_NOT_PERMITTED');
    const admin = await makeUser('platform_admin', 'TEST DATA ONLY - NOT FOR CLINICAL USE');
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: admin.id, role: 'platform_admin' }, meta), (e: AppError) => e.code === 'ROLE_NOT_PERMITTED');
  });

  it('supports supplied coordinates and reports actual quantity without treating qualitative stock as confirmed', async () => {
    const near = await makePharmacy();
    const far = await makePharmacy();
    await prisma.pharmacy.update({ where: { id: far.id }, data: { lat: -8.9, lng: 33.4 } });
    await putStock(near.id, 3, 'TEST SEARCH MEDICINE');
    await putStock(far.id, 9, 'TEST SEARCH MEDICINE');
    const result = await pharmacies.searchMedication({ medication_name: 'TEST SEARCH MEDICINE', lat: -6.8, lng: 39.28, required_quantity: 5, radius_km: 20 });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]!.fulfillment_status, 'partially_available');
    assert.equal(result.data[0]!.quantity_on_hand, 3);
    const noLocation = await pharmacies.searchMedication({ medication_name: 'TEST SEARCH MEDICINE' });
    assert.ok(noLocation.data.every((row) => row.pharmacy.distance_km === null));
    await putStock(far.id, 0, 'TEST OUT OF STOCK MEDICINE');
    const outOfStock = await pharmacies.searchMedication({ medication_name: 'TEST OUT OF STOCK MEDICINE' });
    assert.equal(outOfStock.data.length, 0);
    await putStock(near.id, null, 'TEST QUALITATIVE MEDICINE');
    const unknown = await pharmacies.searchMedication({ medication_name: 'TEST QUALITATIVE MEDICINE' });
    assert.equal(unknown.data[0]!.fulfillment_status, 'unknown');
  });

  it('prioritizes facility pharmacy availability and patient read-back distinguishes on-hand from dispensed', async () => {
    const facility = await makeFacility();
    const { prescription, patient, profile } = await makePrescription({ facilityId: facility.id });
    const facilityPharmacy = await makePharmacy(facility.id);
    await putStock(facilityPharmacy.id, 4);
    const result = await dispensing.getPrescriptionFulfillment(prescription.id, { sub: patient.id, role: 'patient' });
    assert.equal(result.facility_pharmacy?.id, facilityPharmacy.id);
    assert.equal(result.facility_pharmacy?.items[0]?.availability, 'partially_available');
    assert.equal(result.items[0]?.quantity_remaining, 10);
    assert.equal(profile.id, prescription.patientProfileId);
  });

  it('keeps legacy prescriptions without quantities as unknown rather than complete or available', async () => {
    const facility = await makeFacility();
    const { prescription, patient } = await makePrescription({ facilityId: facility.id, quantity: null });
    const facilityPharmacy = await makePharmacy(facility.id);
    await putStock(facilityPharmacy.id, 8);

    const result = await dispensing.getPrescriptionFulfillment(prescription.id, { sub: patient.id, role: 'patient' });

    assert.equal(result.fulfilment_status, 'quantity_unspecified');
    assert.equal(result.items[0]?.status, 'quantity_unspecified');
    assert.equal(result.items[0]?.quantity_dispensed, 0);
    assert.equal(result.items[0]?.quantity_remaining, null);
    assert.equal(result.facility_pharmacy?.items[0]?.quantity_remaining, null);
    assert.equal(result.facility_pharmacy?.items[0]?.availability, 'unknown');
  });
  it('records partial then full dispensing, updates inventory exactly, and rejects excess/replay', async () => {
    const { prescription, patient, item } = await makePrescription();
    const pharmacy = await makePharmacy();
    const stock = await putStock(pharmacy.id, 10);
    const pharmacistA = await makePharmacist(pharmacy.id);
    const pharmacistB = await makePharmacist(pharmacy.id);
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const firstSession = await dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacistA.id, role: 'pharmacist' }, meta);
    const firstInput = { idempotency_key: randomUUID(), items: [{ prescription_item_id: item.id, quantity_dispensed: 4 }] };
    const partial = await dispensing.completeDispensing(firstSession.dispensing_id, { sub: pharmacistA.id, role: 'pharmacist' }, firstInput, meta);
    assert.equal(partial.status, 'partial');
    assert.equal((await prisma.pharmacyStock.findUniqueOrThrow({ where: { id: stock.id } })).quantityOnHand, 6);
    const repeated = await dispensing.completeDispensing(firstSession.dispensing_id, { sub: pharmacistA.id, role: 'pharmacist' }, firstInput, meta);
    assert.equal(repeated.id, partial.id);
    assert.equal((await prisma.pharmacyStock.findUniqueOrThrow({ where: { id: stock.id } })).quantityOnHand, 6);

    const secondSession = await dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacistB.id, role: 'pharmacist' }, meta);
    const full = await dispensing.completeDispensing(secondSession.dispensing_id, { sub: pharmacistB.id, role: 'pharmacist' }, {
      idempotency_key: randomUUID(), items: [{ prescription_item_id: item.id, quantity_dispensed: 6 }],
    }, meta);
    assert.equal(full.status, 'complete');
    assert.equal((await prisma.pharmacyStock.findUniqueOrThrow({ where: { id: stock.id } })).quantityOnHand, 0);
    assert.equal((await prisma.prescription.findUniqueOrThrow({ where: { id: prescription.id } })).status, 'completed');
    const readBack = await dispensing.getPrescriptionFulfillment(prescription.id, { sub: patient.id, role: 'patient' });
    assert.equal(readBack.fulfilment_status, 'complete');
    assert.equal(readBack.items[0]?.quantity_dispensed, 10);
    assert.equal(readBack.dispensing_history.length, 2);
    assert.equal(readBack.dispensing_history[0]?.pharmacy.name, pharmacy.name);
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacistA.id, role: 'pharmacist' }, meta), (e: AppError) => e.code === 'PRESCRIPTION_NOT_ACTIVE');
  });

  it('rolls back when inventory is insufficient and never stores negative stock', async () => {
    const { prescription, patient, item } = await makePrescription();
    const pharmacy = await makePharmacy();
    const stock = await putStock(pharmacy.id, 2);
    const pharmacist = await makePharmacist(pharmacy.id);
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const session = await dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }, meta);
    await assert.rejects(() => dispensing.completeDispensing(session.dispensing_id, { sub: pharmacist.id, role: 'pharmacist' }, {
      idempotency_key: randomUUID(), items: [{ prescription_item_id: item.id, quantity_dispensed: 3 }],
    }, meta), (e: AppError) => e.code === 'INSUFFICIENT_INVENTORY');
    assert.equal((await prisma.pharmacyStock.findUniqueOrThrow({ where: { id: stock.id } })).quantityOnHand, 2);
    assert.equal(await prisma.dispensingItem.count({ where: { dispensing: { prescriptionId: prescription.id } } }), 0);
  });

  it('rejects over-dispensing and serializes concurrent pharmacists on the same prescription', async () => {
    const { prescription, patient, item } = await makePrescription();
    const pharmacy = await makePharmacy();
    const stock = await putStock(pharmacy.id, 20);
    const pharmacists = [await makePharmacist(pharmacy.id), await makePharmacist(pharmacy.id)];
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const sessions = await Promise.all(pharmacists.map((pharmacist) => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }, meta)));
    const attempts = await Promise.allSettled(sessions.map((session, index) => dispensing.completeDispensing(session.dispensing_id,
      { sub: pharmacists[index]!.id, role: 'pharmacist' }, { idempotency_key: randomUUID(), items: [{ prescription_item_id: item.id, quantity_dispensed: 6 }] }, meta)));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await prisma.dispensingItem.aggregate({ where: { prescriptionItemId: item.id }, _sum: { quantityDispensed: true } }).then((r) => r._sum.quantityDispensed), 6);
    assert.equal((await prisma.pharmacyStock.findUniqueOrThrow({ where: { id: stock.id } })).quantityOnHand, 14);
  });

  it('rejects expired and revoked handoff references and blocks use after prescription cancellation', async () => {
    const { prescription, patient } = await makePrescription();
    const pharmacy = await makePharmacy();
    const pharmacist = await makePharmacist(pharmacy.id);
    const issued = await dispensing.issueDispenseCode(prescription.id, { sub: patient.id, role: 'patient' }, meta);
    const stored = await prisma.dispenseCode.findUniqueOrThrow({ where: { codeHash: sha256(issued.reference) } });
    await prisma.dispenseCode.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(() => dispensing.verifyDispenseCode(issued.reference, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }, meta), (e: AppError) => e.code === 'HANDOFF_REFERENCE_EXPIRED');

    const second = await makePrescription();
    const rotated = await dispensing.issueDispenseCode(second.prescription.id, { sub: second.patient.id, role: 'patient' }, meta);
    await dispensing.revokeDispenseCode(second.prescription.id, { sub: second.patient.id, role: 'patient' }, meta);
    await assert.rejects(() => dispensing.verifyDispenseCode(rotated.reference, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }, meta), (e: AppError) => e.code === 'HANDOFF_REFERENCE_REVOKED');

    const cancelled = await makePrescription({ status: 'discontinued' });
    const legacyReference = randomUUID().replace(/-/g, '').padEnd(43, 'x').slice(0, 43);
    await prisma.dispenseCode.create({ data: { prescriptionId: cancelled.prescription.id, codeHash: sha256(legacyReference), expiresAt: new Date(Date.now() + 60_000) } });
    await assert.rejects(() => dispensing.verifyDispenseCode(legacyReference, pharmacy.id, { sub: pharmacist.id, role: 'pharmacist' }, meta), (e: AppError) => e.code === 'PRESCRIPTION_NOT_ACTIVE');
  });

  it('leaves the append-only Audit Ledger valid', async () => {
    const result = await verifyAuditChain();
    assert.equal(result.ok, true);
    assert.ok(result.eventsChecked > 0);
  });
});
