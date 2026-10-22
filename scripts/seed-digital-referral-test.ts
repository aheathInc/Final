import 'dotenv/config';
import { prisma } from '../packages/database/src/client.js';
import { hashPassword } from '../services/auth/src/utils/password.js';

const IDS = {
  sourceFacility: '77777777-7777-4777-8777-777777777701',
  sourceDepartment: '77777777-7777-4777-8777-777777777702',
  destinationFacility: '77777777-7777-4777-8777-777777777703',
  destinationDepartment: '77777777-7777-4777-8777-777777777704',
  unrelatedFacility: '77777777-7777-4777-8777-777777777705',
  unrelatedDepartment: '77777777-7777-4777-8777-777777777706',
  doctorAUser: '77777777-7777-4777-8777-777777777707',
  doctorA: '77777777-7777-4777-8777-777777777708',
  doctorBUser: '77777777-7777-4777-8777-777777777709',
  doctorB: '77777777-7777-4777-8777-777777777710',
  doctorCUser: '77777777-7777-4777-8777-777777777711',
  doctorC: '77777777-7777-4777-8777-777777777712',
  patientAUser: '77777777-7777-4777-8777-777777777713',
  patientA: '77777777-7777-4777-8777-777777777714',
  patientBUser: '77777777-7777-4777-8777-777777777715',
  patientB: '77777777-7777-4777-8777-777777777716',
  careThread: '77777777-7777-4777-8777-777777777717',
  consultation: '77777777-7777-4777-8777-777777777718',
  consent: '77777777-7777-4777-8777-777777777719',
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = new URL(databaseUrl);
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
  if (databaseName !== 'ahealth_test' || !['localhost', '127.0.0.1', '::1'].includes(database.hostname) || (database.port || '5432') === '5432') {
    throw new Error('Refusing fixture writes unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
  }
  const password = process.env.AHP_DIGITAL_REFERRAL_TEST_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Set AHP_DIGITAL_REFERRAL_TEST_PASSWORD to a local synthetic-test password (at least 12 characters).');
  }

  const collision = await Promise.all([
    prisma.facility.findMany({ where: { id: { in: [IDS.sourceFacility, IDS.destinationFacility, IDS.unrelatedFacility] } } }),
    prisma.department.findMany({ where: { id: { in: [IDS.sourceDepartment, IDS.destinationDepartment, IDS.unrelatedDepartment] } } }),
    prisma.user.findMany({ where: { id: { in: [IDS.doctorAUser, IDS.doctorBUser, IDS.doctorCUser, IDS.patientAUser, IDS.patientBUser] } } }),
    prisma.clinicianProfile.findMany({ where: { id: { in: [IDS.doctorA, IDS.doctorB, IDS.doctorC] } } }),
    prisma.patientProfile.findMany({ where: { id: { in: [IDS.patientA, IDS.patientB] } } }),
    prisma.careThread.findUnique({ where: { id: IDS.careThread } }),
    prisma.consultationRequest.findUnique({ where: { id: IDS.consultation } }),
    prisma.patientConsent.findUnique({ where: { id: IDS.consent } }),
  ]);
  if (collision.some((entry) => Array.isArray(entry) ? entry.length > 0 : entry !== null)) {
    throw new Error('Digital referral fixture IDs already exist. No rows were changed.');
  }

  const passwordHash = await hashPassword(password);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  await prisma.$transaction(async (tx) => {
    for (const [id, name] of [
      [IDS.sourceFacility, 'AHP Referral Source Synthetic Facility'],
      [IDS.destinationFacility, 'AHP Referral Destination Synthetic Facility'],
      [IDS.unrelatedFacility, 'AHP Referral Unrelated Synthetic Facility'],
    ] as const) {
      await tx.facility.create({ data: { id, name, type: 'clinic', integrationLevel: 'none' } });
    }
    for (const [id, facilityId, name] of [
      [IDS.sourceDepartment, IDS.sourceFacility, 'Synthetic General Practice A'],
      [IDS.destinationDepartment, IDS.destinationFacility, 'Synthetic General Practice B'],
      [IDS.unrelatedDepartment, IDS.unrelatedFacility, 'Synthetic General Practice C'],
    ] as const) {
      await tx.department.create({ data: { id, facilityId, name, specialty: 'general_practice' } });
    }

    const accounts = [
      { id: IDS.doctorAUser, phoneNumber: '+255700007701', email: 'digital-referral-a@ahealth.test', fullName: 'AHP Referral Doctor A', role: 'clinician' as const },
      { id: IDS.doctorBUser, phoneNumber: '+255700007702', email: 'digital-referral-b@ahealth.test', fullName: 'AHP Referral Doctor B', role: 'clinician' as const },
      { id: IDS.doctorCUser, phoneNumber: '+255700007703', email: 'digital-referral-c@ahealth.test', fullName: 'AHP Referral Doctor C', role: 'clinician' as const },
      { id: IDS.patientAUser, phoneNumber: '+255700007704', email: null, fullName: 'AHP Referral Patient A', role: 'patient' as const },
      { id: IDS.patientBUser, phoneNumber: '+255700007705', email: null, fullName: 'AHP Referral Patient B', role: 'patient' as const },
    ];
    for (const account of accounts) {
      await tx.user.create({ data: { ...account, passwordHash: account.role === 'clinician' ? passwordHash : null, status: 'active', preferredLanguage: 'sw' } });
    }
    for (const [id, userId, facilityId, departmentId, license] of [
      [IDS.doctorA, IDS.doctorAUser, IDS.sourceFacility, IDS.sourceDepartment, 'AHP-REFERRAL-DOCTOR-A'],
      [IDS.doctorB, IDS.doctorBUser, IDS.destinationFacility, IDS.destinationDepartment, 'AHP-REFERRAL-DOCTOR-B'],
      [IDS.doctorC, IDS.doctorCUser, IDS.unrelatedFacility, IDS.unrelatedDepartment, 'AHP-REFERRAL-DOCTOR-C'],
    ] as const) {
      await tx.clinicianProfile.create({
        data: { id, userId, facilityId, departmentId, licenseNumber: license, specialty: 'general_practice', verificationStatus: 'verified' },
      });
    }
    await tx.patientProfile.createMany({ data: [
      { id: IDS.patientA, userId: IDS.patientAUser, fullName: 'AHP Referral Patient A' },
      { id: IDS.patientB, userId: IDS.patientBUser, fullName: 'AHP Referral Patient B' },
    ] });
    await tx.careThread.create({
      data: { id: IDS.careThread, patientProfileId: IDS.patientA, primaryClinicianId: IDS.doctorA, reasonSummary: 'Synthetic digital referral acceptance case' },
    });
    await tx.consultationRequest.create({
      data: {
        id: IDS.consultation, careThreadId: IDS.careThread, patientProfileId: IDS.patientA,
        assignedClinicianId: IDS.doctorA, channel: 'web', modality: 'async',
        symptomText: 'Synthetic referral acceptance summary; not real clinical data.',
        structuredSymptoms: [{ code: 'SYNTHETIC', label: 'acceptance fixture' }],
        urgencyLevel: 'routine', triageRuleVersion: 'digital-referral-test', status: 'in_progress',
        slaDeadlineAt: expiresAt, acceptedAt: new Date(),
      },
    });
    await tx.patientConsent.create({
      data: {
        id: IDS.consent, patientProfileId: IDS.patientA, granteeType: 'facility',
        granteeFacilityId: IDS.destinationFacility, careThreadId: IDS.careThread,
        scope: 'current_thread', allowed: true, breakGlass: false,
        reason: 'Synthetic exact-destination referral authorization.', expiresAt,
      },
    });
  });

  console.log('AHP_DIGITAL_REFERRAL_TEST_V1 created in local ahealth_test.');
  console.log('Synthetic Doctor A: digital-referral-a@ahealth.test');
  console.log('Synthetic Doctor B: digital-referral-b@ahealth.test');
  console.log('Synthetic Doctor C: digital-referral-c@ahealth.test');
  console.log(`Synthetic consultation ID: ${IDS.consultation}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Digital referral fixture creation failed.');
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
