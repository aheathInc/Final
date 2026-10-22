import 'dotenv/config';
import { prisma } from '../packages/database/src/client.js';
import { hashPassword } from '../services/auth/src/utils/password.js';

const IDS = {
  facility: '88888888-8888-4888-8888-888888888801',
  department: '88888888-8888-4888-8888-888888888802',
  outsiderFacility: '88888888-8888-4888-8888-888888888812',
  outsiderDepartment: '88888888-8888-4888-8888-888888888813',
  doctorAUser: '88888888-8888-4888-8888-888888888803',
  doctorAProfile: '88888888-8888-4888-8888-888888888804',
  doctorBUser: '88888888-8888-4888-8888-888888888805',
  doctorBProfile: '88888888-8888-4888-8888-888888888806',
  patientUser: '88888888-8888-4888-8888-888888888807',
  patientProfile: '88888888-8888-4888-8888-888888888808',
  careThread: '88888888-8888-4888-8888-888888888809',
  consultation: '88888888-8888-4888-8888-888888888810',
  consent: '88888888-8888-4888-8888-888888888811',
  doctorEUser: '88888888-8888-4888-8888-888888888814',
  doctorEProfile: '88888888-8888-4888-8888-888888888815',
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = new URL(databaseUrl);
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
  if (
    databaseName !== 'ahealth_test' ||
    !['localhost', '127.0.0.1', '::1'].includes(database.hostname) ||
    (database.port || '5432') === '5432'
  ) {
    throw new Error('Refusing fixture writes unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
  }

  const password = process.env.AHP_PROVIDER_COLLABORATION_TEST_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Set AHP_PROVIDER_COLLABORATION_TEST_PASSWORD to a local synthetic-test password (at least 12 characters).');
  }
  const passwordHash = await hashPassword(password);

  const collision = await Promise.all([
    prisma.facility.findUnique({ where: { id: IDS.facility } }),
    prisma.department.findUnique({ where: { id: IDS.department } }),
    prisma.facility.findUnique({ where: { id: IDS.outsiderFacility } }),
    prisma.department.findUnique({ where: { id: IDS.outsiderDepartment } }),
    prisma.user.findMany({ where: { id: { in: [IDS.doctorAUser, IDS.doctorBUser, IDS.doctorEUser, IDS.patientUser] } } }),
    prisma.clinicianProfile.findMany({ where: { id: { in: [IDS.doctorAProfile, IDS.doctorBProfile, IDS.doctorEProfile] } } }),
    prisma.patientProfile.findUnique({ where: { id: IDS.patientProfile } }),
    prisma.careThread.findUnique({ where: { id: IDS.careThread } }),
    prisma.consultationRequest.findUnique({ where: { id: IDS.consultation } }),
    prisma.patientConsent.findUnique({ where: { id: IDS.consent } }),
  ]);
  if (collision.some((item) => Array.isArray(item) ? item.length > 0 : item !== null)) {
    throw new Error('Provider collaboration fixture IDs already exist. No rows were changed.');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.facility.create({
      data: { id: IDS.facility, name: 'AHP Provider Collaboration Synthetic Facility', type: 'clinic', integrationLevel: 'none' },
    });
    await tx.department.create({
      data: { id: IDS.department, facilityId: IDS.facility, name: 'Synthetic General Practice', specialty: 'general_practice' },
    });
    await tx.facility.create({
      data: { id: IDS.outsiderFacility, name: 'AHP Unrelated Synthetic Facility', type: 'clinic', integrationLevel: 'none' },
    });
    await tx.department.create({
      data: { id: IDS.outsiderDepartment, facilityId: IDS.outsiderFacility, name: 'Synthetic Unrelated Department', specialty: 'general_practice' },
    });
    await tx.user.create({
      data: {
        id: IDS.doctorAUser, phoneNumber: '+255700008801', email: 'provider-collaboration-a@ahealth.test',
        passwordHash, role: 'clinician', status: 'active', fullName: 'AHP Synthetic Doctor A', preferredLanguage: 'sw',
      },
    });
    await tx.user.create({
      data: {
        id: IDS.doctorBUser, phoneNumber: '+255700008802', email: 'provider-collaboration-b@ahealth.test',
        passwordHash, role: 'clinician', status: 'active', fullName: 'AHP Synthetic Doctor B', preferredLanguage: 'sw',
      },
    });
    await tx.clinicianProfile.create({
      data: {
        id: IDS.doctorAProfile, userId: IDS.doctorAUser, facilityId: IDS.facility, departmentId: IDS.department,
        licenseNumber: 'AHP-COLLAB-DOCTOR-A', specialty: 'general_practice', verificationStatus: 'verified',
      },
    });
    await tx.clinicianProfile.create({
      data: {
        id: IDS.doctorBProfile, userId: IDS.doctorBUser, facilityId: IDS.facility, departmentId: IDS.department,
        licenseNumber: 'AHP-COLLAB-DOCTOR-B', specialty: 'general_practice', verificationStatus: 'verified',
      },
    });
    await tx.user.create({
      data: {
        id: IDS.doctorEUser, phoneNumber: '+255700008804', email: 'provider-collaboration-e@ahealth.test',
        passwordHash, role: 'clinician', status: 'active', fullName: 'AHP Synthetic Unrelated Doctor E', preferredLanguage: 'sw',
      },
    });
    await tx.clinicianProfile.create({
      data: {
        id: IDS.doctorEProfile, userId: IDS.doctorEUser, facilityId: IDS.outsiderFacility,
        departmentId: IDS.outsiderDepartment, licenseNumber: 'AHP-COLLAB-DOCTOR-E',
        specialty: 'general_practice', verificationStatus: 'verified',
      },
    });
    await tx.user.create({
      data: {
        id: IDS.patientUser, phoneNumber: '+255700008803', role: 'patient', status: 'active',
        fullName: 'AHP Synthetic Patient A', preferredLanguage: 'sw',
      },
    });
    await tx.patientProfile.create({
      data: { id: IDS.patientProfile, userId: IDS.patientUser, fullName: 'AHP Synthetic Patient A' },
    });
    await tx.careThread.create({
      data: { id: IDS.careThread, patientProfileId: IDS.patientProfile, primaryClinicianId: IDS.doctorAProfile, reasonSummary: 'Synthetic provider collaboration acceptance case' },
    });
    await tx.consultationRequest.create({
      data: {
        id: IDS.consultation,
        careThreadId: IDS.careThread,
        patientProfileId: IDS.patientProfile,
        assignedClinicianId: IDS.doctorAProfile,
        channel: 'web', modality: 'async',
        symptomText: 'Synthetic non-identifying case summary for provider collaboration acceptance.',
        structuredSymptoms: [{ code: 'SYNTHETIC', label: 'test-only symptom' }],
        urgencyLevel: 'routine', triageRuleVersion: 'provider-clinical-collaboration-test',
        status: 'in_progress', slaDeadlineAt: expiresAt, acceptedAt: now,
      },
    });
    await tx.patientConsent.create({
      data: {
        id: IDS.consent,
        patientProfileId: IDS.patientProfile,
        granteeType: 'clinician', granteeClinicianId: IDS.doctorBProfile,
        careThreadId: IDS.careThread, scope: 'current_thread', allowed: true,
        reason: 'Synthetic explicit consent fixture for provider collaboration acceptance.',
        expiresAt,
      },
    });
  });

  console.log('AHP_PROVIDER_CLINICAL_COLLABORATION_TEST_V1 created in local ahealth_test.');
  console.log(`Doctor A login: provider-collaboration-a@ahealth.test`);
  console.log(`Doctor B login: provider-collaboration-b@ahealth.test`);
  console.log(`Doctor E login: provider-collaboration-e@ahealth.test`);
  console.log(`Synthetic consultation: ${IDS.consultation}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Provider collaboration fixture creation failed.');
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
