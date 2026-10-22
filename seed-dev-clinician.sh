#!/usr/bin/env bash
#
# Creates a development clinician you can actually log in as, plus three
# waiting cases at the three urgency levels so the queue has something to
# show and the colour rule is visible.
#
# Without this you can start everything correctly and still land on an empty
# queue behind a login you have no account for — which looks exactly like a
# broken app.
#
# Idempotent: re-running deletes and recreates the seed rows only. It is
# keyed on the seed email, so nothing else in your dev database is touched.
#
# Run from the repo root:
#   bash seed-dev-clinician.sh
#
set -euo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

mkdir -p "$ROOT/packages/database/scripts"

cat > "$ROOT/packages/database/scripts/seed-dev.ts" << 'TS'
import { randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../src/index.js';

/**
 * Development seed. Deliberately keyed on one marker email so re-running is
 * safe and nothing else in the database is affected.
 *
 * The password hash uses the same cost factor the auth service uses (12), so
 * this account logs in through the real POST /auth/login path rather than a
 * back door that only works in seeds.
 */
const CLINICIAN_EMAIL = 'daktari@dev.local';
function readSeedPassword(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Development seed cannot run in production.');
  const value = process.env.AHP_SEED_CLINICIAN_PASSWORD;
  if (!value) throw new Error('AHP_SEED_CLINICIAN_PASSWORD must be exported before running the generated seed.');
  return value;
}
const CLINICIAN_PASSWORD = readSeedPassword();
const MARKER = 'seed-dev';

async function wipePrevious() {
  const existing = await prisma.user.findUnique({
    where: { email: CLINICIAN_EMAIL },
    include: { clinicianProfile: true },
  });
  if (!existing?.clinicianProfile) return;

  const cpid = existing.clinicianProfile.id;
  await prisma.consultationOffer.deleteMany({ where: { clinicianId: cpid } });

  const threads = await prisma.careThread.findMany({
    where: { reasonSummary: { startsWith: MARKER } },
    select: { id: true, patientProfileId: true },
  });
  const threadIds = threads.map((t) => t.id);
  const patientIds = threads.map((t) => t.patientProfileId);

  await prisma.consultationRequest.deleteMany({ where: { careThreadId: { in: threadIds } } });
  await prisma.careThread.deleteMany({ where: { id: { in: threadIds } } });
  await prisma.patientProfile.deleteMany({ where: { id: { in: patientIds } } });
  await prisma.clinicianProfile.delete({ where: { id: cpid } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: existing.id } }).catch(() => undefined);
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

  // Three cases, one per urgency level, so the queue shows the colour rule
  // doing its job rather than a single row that could be any colour.
  // SLA windows follow FR-CN-04: 3 minutes emergency, 15 urgent, 2h routine.
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
      },
    });

    const patient = await prisma.patientProfile.create({
      data: {
        userId: patientUser.id,
        fullName: 'Mgonjwa wa Majaribio',
        dateOfBirth: c.dob,
        sex: c.sex,
        chronicConditions: c.chronic,
        preferredLanguage: 'sw',
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
        rankWeights: { specialty: 0.35, language: 0.25, availability: 0.25, rating: 0.1, proximity: 0.05 },
        status: 'offered',
        expiresAt: new Date(Date.now() + c.slaSeconds * 1000),
      },
    });
  }

  console.log('\nSeed complete.\n');
  console.log('  Log in at http://localhost:3100/login');
  console.log(`  email:    ${CLINICIAN_EMAIL}`);
  console.log('  password is supplied through AHP_SEED_CLINICIAN_PASSWORD');
  console.log('\n  Three cases are waiting: one emergency, one urgent, one routine.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
TS

echo "  packages/database/scripts/seed-dev.ts written"
echo
echo "Run it with:"
echo "  pnpm --filter @a-health/database exec tsx scripts/seed-dev.ts"
