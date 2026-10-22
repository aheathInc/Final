import bcrypt from 'bcrypt';
import { prisma } from '@a-health/database';
import { assertLocalAuthSeedEnvironment } from '../src/config/security.js';

const accountMarker = 'AHP Local Test:';
const localPassword = process.env.AHP_LOCAL_TEST_PASSWORD;

interface LocalAccount {
  email: string;
  phoneNumber: string;
  role: 'platform_admin' | 'facility_admin' | 'clinician' | 'lab_technician' | 'pharmacist' | 'patient';
  name: string;
  licenseNumber?: string;
  specialty?: 'general_practice';
  patient?: boolean;
}

const accounts: LocalAccount[] = [
  { email: 'platform-admin@dev.local', phoneNumber: '+255749901001', role: 'platform_admin', name: 'Platform Admin' },
  { email: 'facility-admin@dev.local', phoneNumber: '+255749901002', role: 'facility_admin', name: 'Facility Admin' },
  {
    email: 'doctor@dev.local', phoneNumber: '+255749901003', role: 'clinician', name: 'Doctor',
    licenseNumber: 'AHP-LOCAL-DEV-DOCTOR-001', specialty: 'general_practice',
  },
  { email: 'lab-tech@dev.local', phoneNumber: '+255749901004', role: 'lab_technician', name: 'Lab Technician' },
  { email: 'pharmacist@dev.local', phoneNumber: '+255749901005', role: 'pharmacist', name: 'Pharmacist' },
  { email: 'patient@dev.local', phoneNumber: '+255749900006', role: 'patient', name: 'Patient', patient: true },
];

async function assertLocalTarget(): Promise<void> {
  assertLocalAuthSeedEnvironment({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL });
  if (process.env.NODE_ENV !== 'development' || !localPassword || localPassword.length < 16) {
    throw new Error('Local role seed requires development mode and the private AHP_LOCAL_TEST_PASSWORD value.');
  }

  const url = new URL(process.env.DATABASE_URL!);
  const expectedDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [identity] = await prisma.$queryRaw<Array<{
    database: string;
    address: string | null;
    port: number;
  }>>`SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port`;
  const address = (identity?.address ?? '').toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  if (expectedDatabase !== 'ahealth_dev' || identity?.database !== expectedDatabase ||
      !['127.0.0.1', '::1'].includes(address) || identity.port !== 55432) {
    throw new Error('Local role seed refused: connected database is not the isolated ahealth_dev instance on port 55432.');
  }
}

async function main(): Promise<void> {
  await assertLocalTarget();
  const encodedPasswordHash = await bcrypt.hash(localPassword!, 12);

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (existing && !existing.fullName?.startsWith(accountMarker)) {
      throw new Error(`Local role seed refused to modify an unmarked account: ${account.email}`);
    }
    const phoneOwner = await prisma.user.findUnique({ where: { phoneNumber: account.phoneNumber } });
    if (phoneOwner && phoneOwner.email !== account.email) {
      throw new Error(`Local role seed phone is already assigned to a different account (${account.phoneNumber}).`);
    }

    const user = await prisma.user.upsert({
      where: { email: account.email },
      create: {
        email: account.email,
        phoneNumber: account.phoneNumber,
        role: account.role,
        status: 'active',
        fullName: `${accountMarker} ${account.name}`,
        passwordHash: encodedPasswordHash,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      update: {
        phoneNumber: account.phoneNumber,
        role: account.role,
        status: 'active',
        fullName: `${accountMarker} ${account.name}`,
        passwordHash: encodedPasswordHash,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (account.patient) {
      await prisma.patientProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, fullName: `${accountMarker} ${account.name}` },
        update: { fullName: `${accountMarker} ${account.name}` },
      });
    }
    if (account.role === 'clinician') {
      await prisma.clinicianProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          licenseNumber: account.licenseNumber!,
          specialty: account.specialty!,
          verificationStatus: 'verified',
          isAvailable: true,
        },
        update: {
          licenseNumber: account.licenseNumber!,
          specialty: account.specialty!,
          verificationStatus: 'verified',
          isAvailable: true,
        },
      });
    }
  }

  const [pharmacist, platformAdmin] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'pharmacist@dev.local' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'platform-admin@dev.local' } }),
  ]);
  const pharmacyLicense = 'AHP-LOCAL-TEST-PHARMACY-001';
  const existingPharmacy = await prisma.pharmacy.findUnique({ where: { licenseNumber: pharmacyLicense } });
  if (existingPharmacy && !existingPharmacy.name.startsWith(accountMarker)) {
    throw new Error('Local pharmacy seed refused to modify an unmarked pharmacy record.');
  }
  const pharmacy = await prisma.pharmacy.upsert({
    where: { licenseNumber: pharmacyLicense },
    create: {
      name: `${accountMarker} Demonstration Pharmacy`,
      licenseNumber: pharmacyLicense,
      isVerified: true,
      isActive: true,
      regionCode: 'DAR',
    },
    update: {
      name: `${accountMarker} Demonstration Pharmacy`,
      isVerified: true,
      isActive: true,
    },
  });
  const membershipLicense = 'AHP-LOCAL-TEST-PHARMACIST-001';
  const existingMembership = await prisma.pharmacyMembership.findUnique({
    where: { userId_pharmacyId: { userId: pharmacist.id, pharmacyId: pharmacy.id } },
  });
  if (existingMembership && existingMembership.professionalLicenseNumber !== membershipLicense) {
    throw new Error('Local pharmacist seed refused to modify an unmarked pharmacy membership.');
  }
  await prisma.pharmacyMembership.upsert({
    where: { userId_pharmacyId: { userId: pharmacist.id, pharmacyId: pharmacy.id } },
    create: {
      userId: pharmacist.id,
      pharmacyId: pharmacy.id,
      professionalLicenseNumber: membershipLicense,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      verifiedByUserId: platformAdmin.id,
    },
    update: {
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      verifiedByUserId: platformAdmin.id,
    },
  });

  console.log(`Created or refreshed ${accounts.length} marked local role accounts.`);
  console.log('Roles: platform_admin, facility_admin, clinician, lab_technician, pharmacist, patient.');
  console.log('The marked local pharmacist has a verified synthetic pharmacy membership; no inventory or patient records are seeded.');
  console.log('The shared local test password is stored in the gitignored .env and was not displayed.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unexpected local seed failure.';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
