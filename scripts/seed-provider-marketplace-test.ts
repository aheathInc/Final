import { prisma } from '../packages/database/src/client.js';
import { hashPassword } from '../services/auth/src/utils/password.js';

const CONFIRM = 'write-local-ahealth_test';
const IDS = {
  facility: '77777777-7777-4777-8777-777777777701',
  patientUser: '77777777-7777-4777-8777-777777777702',
  patientProfile: '77777777-7777-4777-8777-777777777703',
  acceptThread: '77777777-7777-4777-8777-777777777704',
  declineThread: '77777777-7777-4777-8777-777777777705',
  historyThread: '77777777-7777-4777-8777-777777777706',
  acceptConsultation: '77777777-7777-4777-8777-777777777710',
  declineConsultation: '77777777-7777-4777-8777-777777777711',
  completedConsultation: '77777777-7777-4777-8777-777777777712',
} as const;
const REPLAY_IDS = {
  acceptThread: '88888888-8888-4888-8888-888888888804',
  declineThread: '88888888-8888-4888-8888-888888888805',
  historyThread: '88888888-8888-4888-8888-888888888806',
  acceptConsultation: '88888888-8888-4888-8888-888888888810',
  declineConsultation: '88888888-8888-4888-8888-888888888811',
  completedConsultation: '88888888-8888-4888-8888-888888888812',
} as const;

function assertSafeTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL must be a valid local URL.'); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    process.env.NODE_ENV === 'production' ||
    database !== 'ahealth_test' ||
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    (url.port || '5432') === '5432'
  ) {
    throw new Error('Refusing fixture writes unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
  }
  if (process.env.AHP_PROVIDER_MARKETPLACE_TEST_CONFIRM !== CONFIRM) {
    throw new Error(`Set AHP_PROVIDER_MARKETPLACE_TEST_CONFIRM=${CONFIRM} to create isolated synthetic fixtures.`);
  }
  if (!process.env.AHP_PROVIDER_MARKETPLACE_TEST_PASSWORD || process.env.AHP_PROVIDER_MARKETPLACE_TEST_PASSWORD.length < 12) {
    throw new Error('Set AHP_PROVIDER_MARKETPLACE_TEST_PASSWORD to a local synthetic test password.');
  }
}

async function main() {
  assertSafeTarget();
  const emailA = 'marketplace.doctor.a@dev.local';
  const emailB = 'marketplace.doctor.b@dev.local';
  const emailAdmin = 'marketplace.admin@dev.local';
  const emailPending = 'marketplace.pending@dev.local';
  if (process.argv.includes('--replay')) {
    const doctorA = await prisma.user.findUnique({ where: { email: emailA } });
    const patient = await prisma.patientProfile.findUnique({ where: { id: IDS.patientProfile } });
    const pendingEmail = 'marketplace.pending.b@dev.local';
    if (!doctorA || !patient || !await prisma.clinicianProfile.findUnique({ where: { userId: doctorA.id } })) {
      throw new Error('Base marketplace test fixtures are required before replay fixtures.');
    }
    const collision = await Promise.all([
      prisma.consultationRequest.findMany({ where: { id: { in: [REPLAY_IDS.acceptConsultation, REPLAY_IDS.declineConsultation, REPLAY_IDS.completedConsultation] } } }),
      prisma.careThread.findMany({ where: { id: { in: [REPLAY_IDS.acceptThread, REPLAY_IDS.declineThread, REPLAY_IDS.historyThread] } } }),
      prisma.user.findUnique({ where: { email: pendingEmail } }),
    ]);
    if (collision[0].length || collision[1].length || collision[2]) {
      throw new Error('Replay fixture identifiers already exist; refusing to overwrite records.');
    }
    const profileA = await prisma.clinicianProfile.findUniqueOrThrow({ where: { userId: doctorA.id } });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    await prisma.$transaction(async (tx) => {
      const pendingUser = await tx.user.create({
        data: { phoneNumber: '+255700009106', email: pendingEmail, role: 'clinician', status: 'pending_verification', fullName: 'AHP Marketplace Pending Doctor B', preferredLanguage: 'sw' },
      });
      await tx.clinicianProfile.create({
        data: {
          userId: pendingUser.id,
          facilityId: IDS.facility,
          licenseNumber: 'AHP-MKT-TEST-PENDING-B',
          specialty: 'paediatrics',
          verificationStatus: 'pending',
          languagesSpoken: ['sw'],
        },
      });
      for (const [id, reasonSummary] of [
        [REPLAY_IDS.acceptThread, 'Synthetic marketplace replay accept fixture'],
        [REPLAY_IDS.declineThread, 'Synthetic marketplace replay decline fixture'],
        [REPLAY_IDS.historyThread, 'Synthetic marketplace replay history fixture'],
      ] as const) {
        await tx.careThread.create({ data: { id, patientProfileId: IDS.patientProfile, reasonSummary } });
      }
      const accepted = await tx.consultationRequest.create({
        data: {
          id: REPLAY_IDS.acceptConsultation,
          careThreadId: REPLAY_IDS.acceptThread,
          patientProfileId: IDS.patientProfile,
          channel: 'web', modality: 'chat',
          symptomText: 'Synthetic marketplace replay request for acceptance workflow coverage.',
          urgencyLevel: 'routine', triageRuleVersion: 'provider-marketplace-test',
          status: 'offered', slaDeadlineAt: expiresAt,
        },
      });
      const declined = await tx.consultationRequest.create({
        data: {
          id: REPLAY_IDS.declineConsultation,
          careThreadId: REPLAY_IDS.declineThread,
          patientProfileId: IDS.patientProfile,
          channel: 'web', modality: 'chat',
          symptomText: 'Synthetic marketplace replay request for decline and fallback routing coverage.',
          urgencyLevel: 'routine', triageRuleVersion: 'provider-marketplace-test',
          status: 'offered', slaDeadlineAt: expiresAt,
        },
      });
      for (const consultation of [accepted, declined]) {
        await tx.consultationOffer.create({
          data: {
            consultationId: consultation.id,
            clinicianId: profileA.id,
            rankScore: 1,
            rankWeights: { namespace: 'AHP_PROVIDER_MARKETPLACE_TEST_V1_REPLAY' },
            status: 'offered', expiresAt,
          },
        });
      }
      await tx.consultationRequest.create({
        data: {
          id: REPLAY_IDS.completedConsultation,
          careThreadId: REPLAY_IDS.historyThread,
          patientProfileId: IDS.patientProfile,
          assignedClinicianId: profileA.id,
          channel: 'web', modality: 'chat',
          symptomText: 'Synthetic completed-work replay history fixture.',
          urgencyLevel: 'routine', triageRuleVersion: 'provider-marketplace-test',
          status: 'completed', slaDeadlineAt: expiresAt,
          acceptedAt: new Date(now.getTime() - 60_000), completedAt: now,
        },
      });
    });
    console.log('AHP_PROVIDER_MARKETPLACE_TEST_V1 replay fixtures created in local ahealth_test.');
    console.log(`Accept fixture: ${REPLAY_IDS.acceptConsultation}`);
    console.log(`Decline fixture: ${REPLAY_IDS.declineConsultation}`);
    console.log(`Completed history fixture: ${REPLAY_IDS.completedConsultation}`);
    return;
  }

  const collision = await Promise.all([
    prisma.facility.findUnique({ where: { id: IDS.facility } }),
    prisma.consultationRequest.findMany({ where: { id: { in: [IDS.acceptConsultation, IDS.declineConsultation, IDS.completedConsultation] } } }),
    prisma.user.findMany({ where: { email: { in: [emailA, emailB, emailAdmin, emailPending] } } }),
  ]);
  if (collision[0] || collision[1].length || collision[2].length) {
    throw new Error('Marketplace test fixture identifiers already exist; refusing to overwrite records.');
  }

  const passwordHash = await hashPassword(process.env.AHP_PROVIDER_MARKETPLACE_TEST_PASSWORD!);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60_000);

  await prisma.$transaction(async (tx) => {
    await tx.facility.create({
      data: {
        id: IDS.facility,
        name: 'AHP Marketplace Synthetic Test Facility',
        type: 'clinic',
        lat: -6.8,
        lng: 39.28,
        regionCode: 'TEST',
        integrationLevel: 'none',
      },
    });

    const doctorA = await tx.user.create({
      data: { phoneNumber: '+255700009101', email: emailA, passwordHash, role: 'clinician', status: 'active', fullName: 'AHP Marketplace Doctor A', preferredLanguage: 'sw' },
    });
    const doctorB = await tx.user.create({
      data: { phoneNumber: '+255700009102', email: emailB, passwordHash, role: 'clinician', status: 'active', fullName: 'AHP Marketplace Doctor B', preferredLanguage: 'sw' },
    });
    const admin = await tx.user.create({
      data: { phoneNumber: '+255700009103', email: emailAdmin, passwordHash, role: 'platform_admin', status: 'active', fullName: 'AHP Marketplace Test Admin', preferredLanguage: 'sw' },
    });
    const pendingUser = await tx.user.create({
      data: { phoneNumber: '+255700009104', email: emailPending, role: 'clinician', status: 'pending_verification', fullName: 'AHP Marketplace Pending Doctor', preferredLanguage: 'sw' },
    });
    void admin;

    const profileA = await tx.clinicianProfile.create({
      data: {
        userId: doctorA.id,
        facilityId: IDS.facility,
        licenseNumber: 'AHP-MKT-TEST-DOCTOR-A',
        specialty: 'general_practice',
        verificationStatus: 'verified',
        languagesSpoken: ['sw', 'en'],
        isAvailable: true,
      },
    });
    await tx.clinicianProfile.create({
      data: {
        userId: doctorB.id,
        facilityId: IDS.facility,
        licenseNumber: 'AHP-MKT-TEST-DOCTOR-B',
        specialty: 'general_practice',
        verificationStatus: 'verified',
        languagesSpoken: ['sw', 'en'],
        isAvailable: true,
      },
    });
    await tx.clinicianProfile.create({
      data: {
        userId: pendingUser.id,
        facilityId: IDS.facility,
        licenseNumber: 'AHP-MKT-TEST-PENDING',
        specialty: 'paediatrics',
        verificationStatus: 'pending',
        languagesSpoken: ['sw'],
      },
    });

    await tx.user.create({
      data: { id: IDS.patientUser, phoneNumber: '+255700009105', role: 'patient', status: 'active', fullName: 'AHP Marketplace Synthetic Patient', preferredLanguage: 'sw' },
    });
    await tx.patientProfile.create({
      data: {
        id: IDS.patientProfile,
        userId: IDS.patientUser,
        fullName: 'AHP Marketplace Synthetic Patient',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
        sex: 'female',
        chronicConditions: [],
      },
    });

    for (const [id, reasonSummary] of [
      [IDS.acceptThread, 'Synthetic marketplace accept fixture'],
      [IDS.declineThread, 'Synthetic marketplace decline fixture'],
      [IDS.historyThread, 'Synthetic marketplace completed-history fixture'],
    ] as const) {
      await tx.careThread.create({ data: { id, patientProfileId: IDS.patientProfile, reasonSummary } });
    }

    const accepted = await tx.consultationRequest.create({
      data: {
        id: IDS.acceptConsultation,
        careThreadId: IDS.acceptThread,
        patientProfileId: IDS.patientProfile,
        channel: 'web',
        modality: 'chat',
        symptomText: 'Synthetic marketplace request for acceptance workflow coverage.',
        urgencyLevel: 'routine',
        triageRuleVersion: 'provider-marketplace-test',
        status: 'offered',
        slaDeadlineAt: expiresAt,
      },
    });
    const declined = await tx.consultationRequest.create({
      data: {
        id: IDS.declineConsultation,
        careThreadId: IDS.declineThread,
        patientProfileId: IDS.patientProfile,
        channel: 'web',
        modality: 'chat',
        symptomText: 'Synthetic marketplace request for decline and fallback routing coverage.',
        urgencyLevel: 'routine',
        triageRuleVersion: 'provider-marketplace-test',
        status: 'offered',
        slaDeadlineAt: expiresAt,
      },
    });
    for (const consultation of [accepted, declined]) {
      await tx.consultationOffer.create({
        data: {
          consultationId: consultation.id,
          clinicianId: profileA.id,
          rankScore: 1,
          rankWeights: { namespace: 'AHP_PROVIDER_MARKETPLACE_TEST_V1' },
          status: 'offered',
          expiresAt,
        },
      });
    }

    await tx.consultationRequest.create({
      data: {
        id: IDS.completedConsultation,
        careThreadId: IDS.historyThread,
        patientProfileId: IDS.patientProfile,
        assignedClinicianId: profileA.id,
        channel: 'web',
        modality: 'chat',
        symptomText: 'Synthetic completed-work history fixture.',
        urgencyLevel: 'routine',
        triageRuleVersion: 'provider-marketplace-test',
        status: 'completed',
        slaDeadlineAt: expiresAt,
        acceptedAt: new Date(now.getTime() - 60_000),
        completedAt: now,
      },
    });
  });

  console.log('AHP_PROVIDER_MARKETPLACE_TEST_V1 fixtures created in local ahealth_test.');
  console.log(`Accept fixture: ${IDS.acceptConsultation}`);
  console.log(`Decline fixture: ${IDS.declineConsultation}`);
  console.log(`Completed history fixture: ${IDS.completedConsultation}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Marketplace fixture setup failed.');
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
