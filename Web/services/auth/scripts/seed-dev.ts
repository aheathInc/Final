import { randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '@a-health/database';

/**
 * Development seed: one clinician you can log in as, and three waiting cases
 * at the three urgency levels so the queue has something to show.
 *
 * Lives in services/auth because that is the one package that already
 * depends on both the database singleton and bcrypt — the password is hashed
 * at the same cost factor (12) the auth service uses, so this account logs
 * in through the real POST /auth/login rather than a back door that only
 * works for seeded data.
 *
 * Keyed on one marker so re-running is safe: it removes only what it made.
 */
const CLINICIAN_EMAIL = 'daktari@dev.local';
const CLINICIAN_PASSWORD = 'Daktari#2026';
const MARKER = 'seed-dev';

async function wipePrevious() {
  const existing = await prisma.user.findUnique({
    where: { email: CLINICIAN_EMAIL },
    include: { clinicianProfile: true },
  });

  const threads = await prisma.careThread.findMany({
    where: { reasonSummary: { startsWith: MARKER } },
    select: { id: true, patientProfileId: true },
  });
  const threadIds = threads.map((t) => t.id);
  const patientProfileIds = threads.map((t) => t.patientProfileId);

  if (existing?.clinicianProfile) {
    await prisma.consultationOffer.deleteMany({
      where: { clinicianId: existing.clinicianProfile.id },
    });
  }
  await prisma.consultationRequest.deleteMany({ where: { careThreadId: { in: threadIds } } });
  await prisma.careThread.deleteMany({ where: { id: { in: threadIds } } });

  const patientUserIds = (
    await prisma.patientProfile.findMany({
      where: { id: { in: patientProfileIds } },
      select: { userId: true },
    })
  )
    .map((p) => p.userId)
    .filter((id): id is string => Boolean(id));

  await prisma.patientProfile.deleteMany({ where: { id: { in: patientProfileIds } } });
  await prisma.user.deleteMany({ where: { id: { in: patientUserIds } } });

  if (existing) {
    await prisma.clinicianProfile.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } }).catch(() => undefined);
  }
}

async function main() {
  await wipePrevious();

  const clinicianUser = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: CLINICIAN_EMAIL,
      passwordHash: await bcrypt.hash(CLINICIAN_PASSWORD, 12),
      role: 'clinician',
      status: 'active',
      fullName: 'Asha Mwakalinga',
    },
  });

  const clinician = await prisma.clinicianProfile.create({
    data: {
      userId: clinicianUser.id,
      licenseNumber: `DEV-${randomInt(100000, 999999)}`,
      specialty: 'general_practice',
      verificationStatus: 'verified',
      isAvailable: true,
    },
  });

  // One case per urgency level, so the queue shows the colour rule doing its
  // job rather than a single row that could be any colour. SLA windows follow
  // FR-CN-04: 3 minutes emergency, 15 urgent, 2 hours routine.
  const cases = [
    {
      urgency: 'emergency' as const,
      slaSeconds: 180,
      symptom: 'Maumivu makali ya kifua tangu asubuhi, anahema kwa shida.',
      dob: new Date('1968-04-12'),
      sex: 'male' as const,
      chronic: ['hypertension'],
      rank: 0.91,
    },
    {
      urgency: 'urgent' as const,
      slaSeconds: 900,
      symptom: 'Homa kali siku tatu, mtoto hali chakula wala hanywi maji.',
      dob: new Date('2021-09-02'),
      sex: 'female' as const,
      chronic: [],
      rank: 0.78,
    },
    {
      urgency: 'routine' as const,
      slaSeconds: 7200,
      symptom: 'Muwasho wa ngozi mkononi kwa wiki mbili, hauumi.',
      dob: new Date('1995-01-20'),
      sex: 'female' as const,
      chronic: [],
      rank: 0.52,
    },
  ];

  for (const c of cases) {
    const patientUser = await prisma.user.create({
      data: {
        phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
        role: 'patient',
        status: 'active',
        fullName: 'Mgonjwa wa Majaribio',
        // On User, not PatientProfile — the profile has no language field.
        preferredLanguage: 'sw',
      },
    });

    const patient = await prisma.patientProfile.create({
      data: {
        userId: patientUser.id,
        fullName: 'Mgonjwa wa Majaribio',
        dateOfBirth: c.dob,
        sex: c.sex,
        chronicConditions: c.chronic,
      },
    });

    const thread = await prisma.careThread.create({
      data: {
        patientProfileId: patient.id,
        reasonSummary: `${MARKER}: ${c.symptom.slice(0, 40)}`,
      },
    });

    const consultation = await prisma.consultationRequest.create({
      data: {
        careThreadId: thread.id,
        patientProfileId: patient.id,
        channel: 'app',
        modality: 'chat',
        urgencyLevel: c.urgency,
        triageRuleVersion: '2026.08.1',
        status: 'offered',
        symptomText: c.symptom,
        slaDeadlineAt: new Date(Date.now() + c.slaSeconds * 1000),
      },
    });

    await prisma.consultationOffer.create({
      data: {
        consultationId: consultation.id,
        clinicianId: clinician.id,
        rankScore: c.rank,
        rankWeights: {
          specialty: 0.35,
          language: 0.25,
          availability: 0.25,
          rating: 0.1,
          proximity: 0.05,
        },
        status: 'offered',
        expiresAt: new Date(Date.now() + c.slaSeconds * 1000),
      },
    });
  }

  console.log('\nSeed complete.\n');
  console.log('  Log in at http://localhost:3100/login');
  console.log(`  email:    ${CLINICIAN_EMAIL}`);
  console.log(`  password: ${CLINICIAN_PASSWORD}`);
  console.log('\n  Three cases are waiting: one emergency, one urgent, one routine.');
  console.log('  The emergency SLA is 3 minutes, so re-run this to reset the countdowns.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
