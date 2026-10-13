import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { parse as parseDotenv } from 'dotenv';
import { prisma, type Prisma } from '@a-health/database';
import { assertLocalPharmacyFixtureTarget } from '../src/config/security.js';

const marker = 'TEST DATA ONLY - NOT FOR CLINICAL USE';
const testMedication = `${marker} - SYNTHETIC MEDICINE`;
const accounts = {
  clinician: {
    email: 'pharmacy-clinician@smart-pharmacy.test',
    phoneNumber: '+15555550101',
    fullName: `${marker} - Prescribing Clinician`,
    role: 'clinician' as const,
    passwordKey: 'AHP_PHARMACY_CLINICIAN_PASSWORD',
  },
  pharmacistA: {
    email: 'pharmacist-a@smart-pharmacy.test',
    phoneNumber: '+15555550102',
    fullName: `${marker} - Pharmacist A`,
    role: 'pharmacist' as const,
    passwordKey: 'AHP_PHARMACY_PHARMACIST_A_PASSWORD',
  },
  pharmacistB: {
    email: 'pharmacist-b@smart-pharmacy.test',
    phoneNumber: '+15555550103',
    fullName: `${marker} - Pharmacist B`,
    role: 'pharmacist' as const,
    passwordKey: 'AHP_PHARMACY_PHARMACIST_B_PASSWORD',
  },
  pharmacistC: {
    email: 'pharmacist-c@smart-pharmacy.test',
    phoneNumber: '+15555550104',
    fullName: `${marker} - Pharmacist C`,
    role: 'pharmacist' as const,
    passwordKey: 'AHP_PHARMACY_PHARMACIST_C_PASSWORD',
  },
  admin: {
    email: 'pharmacy-admin@smart-pharmacy.test',
    phoneNumber: '+15555550106',
    fullName: `${marker} - Platform Admin Authorization Check`,
    role: 'platform_admin' as const,
    passwordKey: 'AHP_PHARMACY_ADMIN_PASSWORD',
  },
} as const;

type FixturePasswordKey = typeof accounts[keyof typeof accounts]['passwordKey'];
type FixtureCredentials = Record<FixturePasswordKey, string>;
type FixtureTransaction = Prisma.TransactionClient;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureCredentialPath = resolve(root, '.local', 'pharmacy-acceptance.env');
const verifier = {
  email: 'pharmacy-fixture-verifier@smart-pharmacy.test',
  phoneNumber: '+15555550105',
  fullName: `${marker} - Suspended Fixture Verifier`,
};
const facilityAName = `${marker} - Facility A`;

async function assertDatabaseIdentity(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    current_database: string;
    server_address: string | null;
    server_port: number | null;
  }>>`SELECT current_database(), inet_server_addr()::text AS server_address, inet_server_port() AS server_port`;
  const identity = rows[0];
  if (!identity) throw new Error('Could not verify the connected PostgreSQL identity.');

  assertLocalPharmacyFixtureTarget({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    currentDatabase: identity.current_database,
    serverAddress: identity.server_address,
    serverPort: identity.server_port,
  });
}

async function loadOrCreateCredentials(): Promise<FixtureCredentials> {
  const ignoreRules = await readFile(resolve(root, '.gitignore'), 'utf8');
  if (!ignoreRules.split(/\r?\n/).includes('.local/')) {
    throw new Error('Refusing to store fixture credentials because Web/.local is not gitignored.');
  }

  let contents: string;
  try {
    contents = await readFile(fixtureCredentialPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const generated = Object.fromEntries(
      Object.values(accounts).map((account) => [account.passwordKey, randomBytes(32).toString('base64url')]),
    ) as FixtureCredentials;
    const text = Object.entries(generated).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    try {
      await writeFile(fixtureCredentialPath, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      contents = text;
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
      contents = await readFile(fixtureCredentialPath, 'utf8');
    }
  }

  const parsed = parseDotenv(contents);
  const missing = Object.values(accounts).filter((account) => !parsed[account.passwordKey]);
  if (missing.length) {
    const additions = Object.fromEntries(
      missing.map((account) => [account.passwordKey, randomBytes(32).toString('base64url')]),
    ) as Partial<FixtureCredentials>;
    const appended = Object.entries(additions).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    await writeFile(fixtureCredentialPath, `${contents.trimEnd()}\n${appended}`, { encoding: 'utf8' });
    Object.assign(parsed, additions);
  }
  const credentials = {} as FixtureCredentials;
  for (const account of Object.values(accounts)) {
    const value = parsed[account.passwordKey];
    if (!value || value.length < 32) {
      throw new Error(`Local fixture credential ${account.passwordKey} is missing or too short.`);
    }
    credentials[account.passwordKey] = value;
  }
  return credentials;
}

async function ensureUser(
  tx: FixtureTransaction,
  account: typeof accounts[keyof typeof accounts],
  passwordHash: string,
) {
  const existing = await tx.user.findUnique({ where: { email: account.email } });
  if (existing) {
    if (existing.role !== account.role || existing.status !== 'active' ||
        existing.fullName !== account.fullName || existing.phoneNumber !== account.phoneNumber) {
      throw new Error(`Refusing to modify the existing non-fixture account for ${account.email}.`);
    }
    return tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
  }

  return tx.user.create({
    data: {
      email: account.email,
      phoneNumber: account.phoneNumber,
      fullName: account.fullName,
      role: account.role,
      status: 'active',
      passwordHash,
    },
  });
}

async function ensureVerifier(tx: FixtureTransaction) {
  const existing = await tx.user.findUnique({ where: { email: verifier.email } });
  if (existing) {
    if (existing.role !== 'platform_admin' || existing.status !== 'suspended' ||
        existing.fullName !== verifier.fullName || existing.phoneNumber !== verifier.phoneNumber || existing.passwordHash !== null) {
      throw new Error('Refusing to use an existing non-fixture membership verifier.');
    }
    return existing;
  }
  return tx.user.create({
    data: {
      email: verifier.email,
      phoneNumber: verifier.phoneNumber,
      fullName: verifier.fullName,
      role: 'platform_admin',
      status: 'suspended',
      passwordHash: null,
    },
  });
}

async function ensureFacilityA(tx: FixtureTransaction) {
  const matches = await tx.facility.findMany({ where: { name: facilityAName } });
  if (matches.length > 1) throw new Error('More than one synthetic Facility A fixture exists.');
  const existing = matches[0];
  if (existing) {
    if (existing.type !== 'clinic' || !existing.isActive) throw new Error('Facility A fixture has unexpected attributes.');
    return existing;
  }
  return tx.facility.create({ data: { name: facilityAName, type: 'clinic', isActive: true } });
}

async function ensurePharmacy(
  tx: FixtureTransaction,
  input: { suffix: 'A' | 'B' | 'C'; facilityId?: string },
) {
  const licenseNumber = `TEST-PHARMACY-${input.suffix}`;
  const name = `${marker} - ${input.suffix === 'A' ? 'Facility Pharmacy A' : input.suffix === 'B' ? 'External Pharmacy B' : 'Unrelated Pharmacy C'}`;
  const existing = await tx.pharmacy.findUnique({ where: { licenseNumber } });
  if (existing) {
    if (existing.name !== name || existing.facilityId !== (input.facilityId ?? null) || !existing.isActive || !existing.isVerified) {
      throw new Error(`Refusing to reuse the non-fixture pharmacy with license marker ${licenseNumber}.`);
    }
    return existing;
  }
  return tx.pharmacy.create({
    data: {
      licenseNumber,
      name,
      facilityId: input.facilityId,
      lat: -6.8,
      lng: 39.28,
      isActive: true,
      isVerified: true,
    },
  });
}

async function ensureMembership(
  tx: FixtureTransaction,
  input: { userId: string; pharmacyId: string; suffix: 'A' | 'B' | 'C'; verifierId: string },
) {
  const professionalLicenseNumber = `TEST-LICENSE-PHARMACIST-${input.suffix}`;
  const existing = await tx.pharmacyMembership.findUnique({
    where: { userId_pharmacyId: { userId: input.userId, pharmacyId: input.pharmacyId } },
  });
  if (existing) {
    if (existing.professionalLicenseNumber !== professionalLicenseNumber || !existing.isActive ||
        !existing.isVerified || !existing.verifiedAt || existing.verifiedByUserId !== input.verifierId) {
      throw new Error(`Pharmacist ${input.suffix} has an unexpected existing membership fixture.`);
    }
    return existing;
  }
  return tx.pharmacyMembership.create({
    data: {
      userId: input.userId,
      pharmacyId: input.pharmacyId,
      professionalLicenseNumber,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      verifiedByUserId: input.verifierId,
    },
  });
}

async function ensureStock(tx: FixtureTransaction, pharmacyId: string, quantityOnHand: number) {
  const existing = await tx.pharmacyStock.findUnique({
    where: { pharmacyId_medicationName: { pharmacyId, medicationName: testMedication } },
  });
  if (existing) {
    return tx.pharmacyStock.update({
      where: { id: existing.id },
      data: { quantityOnHand, stockStatus: 'in_stock', lastReportedAt: new Date() },
    });
  }
  return tx.pharmacyStock.create({
    data: { pharmacyId, medicationName: testMedication, quantityOnHand, stockStatus: 'in_stock' },
  });
}

async function ensureClinicianProfile(tx: FixtureTransaction, userId: string, facilityId: string) {
  const existing = await tx.clinicianProfile.findUnique({ where: { userId } });
  if (existing) {
    if (existing.facilityId !== facilityId || existing.licenseNumber !== 'TEST-CLINICIAN-PHARMACY-ACCEPTANCE' ||
        existing.verificationStatus !== 'verified' || !existing.isAvailable) {
      throw new Error('Refusing to reuse the clinician account with a non-fixture profile.');
    }
    return existing;
  }
  return tx.clinicianProfile.create({
    data: {
      userId,
      facilityId,
      licenseNumber: 'TEST-CLINICIAN-PHARMACY-ACCEPTANCE',
      specialty: 'general_practice',
      verificationStatus: 'verified',
      isAvailable: true,
    },
  });
}

async function main() {
  await assertDatabaseIdentity();
  const credentials = await loadOrCreateCredentials();
  const passwordHashes = await Promise.all(Object.values(accounts).map((account) => bcrypt.hash(credentials[account.passwordKey], 12)));
  const hashByKey = new Map(Object.values(accounts).map((account, index) => [account.passwordKey, passwordHashes[index]!]));

  await prisma.$transaction(async (tx) => {
    const facilityA = await ensureFacilityA(tx);
    const verifierUser = await ensureVerifier(tx);
    const clinician = await ensureUser(tx, accounts.clinician, hashByKey.get(accounts.clinician.passwordKey)!);
    await ensureClinicianProfile(tx, clinician.id, facilityA.id);
    await ensureUser(tx, accounts.admin, hashByKey.get(accounts.admin.passwordKey)!);

    const pharmacistA = await ensureUser(tx, accounts.pharmacistA, hashByKey.get(accounts.pharmacistA.passwordKey)!);
    const pharmacistB = await ensureUser(tx, accounts.pharmacistB, hashByKey.get(accounts.pharmacistB.passwordKey)!);
    const pharmacistC = await ensureUser(tx, accounts.pharmacistC, hashByKey.get(accounts.pharmacistC.passwordKey)!);

    const pharmacyA = await ensurePharmacy(tx, { suffix: 'A', facilityId: facilityA.id });
    const pharmacyB = await ensurePharmacy(tx, { suffix: 'B' });
    const pharmacyC = await ensurePharmacy(tx, { suffix: 'C' });

    await ensureMembership(tx, { userId: pharmacistA.id, pharmacyId: pharmacyA.id, suffix: 'A', verifierId: verifierUser.id });
    await ensureMembership(tx, { userId: pharmacistB.id, pharmacyId: pharmacyB.id, suffix: 'B', verifierId: verifierUser.id });
    await ensureMembership(tx, { userId: pharmacistC.id, pharmacyId: pharmacyC.id, suffix: 'C', verifierId: verifierUser.id });

    await ensureStock(tx, pharmacyA.id, 5);
    await ensureStock(tx, pharmacyB.id, 20);
    await ensureStock(tx, pharmacyC.id, 20);
  });

  console.info('Synthetic pharmacy acceptance fixtures are ready; credential values remain in ignored local configuration.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown fixture provisioning error.';
    console.error(`Pharmacy acceptance fixture provisioning failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
