#!/usr/bin/env bash
#
# Builds services/pharmacy — medication availability, and the dispensing
# handoff. A prescription is not treatment; obtaining the medicine is.
#
# The dispense code is a single-use, hashed, short-lived credential the
# patient presents at the counter. The pharmacist's view of the prescription
# is deliberately narrow: items, dose, prescriber — never the diagnosis.
# Substitution is never silent: it requires an approver, enforced in code.
#
# Run from the repo root:
#   bash setup-pharmacy-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/pharmacy"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/pharmacy';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts' };
pkg.dependencies = { ...(pkg.dependencies || {}),
  '@a-health/database': 'workspace:*', '@a-health/http': 'workspace:*',
  '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2', express: '^5.1.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0',
  tsx: '^4.23.5', typescript: '^5.9.3' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4011),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Long enough to reach a counter across town; short enough not to sit valid for weeks. */
  DISPENSE_CODE_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

# --- pharmacy directory + search ---------------------------------------------
cat > "$SVC/src/services/pharmacy.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { cursorArgs, toCursorPage } from '@a-health/http';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function serialisePharmacy(p: {
  id: string; name: string; licenseNumber: string; isVerified: boolean;
  lat: number | null; lng: number | null; contactPhone: string | null; openingHours: string | null;
}, distanceKm?: number) {
  return {
    id: p.id,
    name: p.name,
    license_number: p.licenseNumber,
    is_verified: p.isVerified,
    location: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
    distance_km: distanceKm ?? null,
    contact_phone: p.contactPhone,
    opening_hours: p.openingHours,
  };
}

export async function listPharmacies(query: {
  lat?: number; lng?: number; radius_km?: number; cursor?: string; limit: number;
}) {
  const rows = await prisma.pharmacy.findMany({
    // Only verified, appropriately licensed pharmacies participate — checked
    // on every read, not just at onboarding.
    where: { isVerified: true, isActive: true },
    orderBy: { name: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });

  const withDistance = rows.map((p) => ({
    row: p,
    distance:
      query.lat != null && query.lng != null && p.lat != null && p.lng != null
        ? haversineKm(query.lat, query.lng, p.lat, p.lng)
        : undefined,
  }));

  const radius = query.radius_km ?? 10;
  const filtered = query.lat != null && query.lng != null
    ? withDistance.filter((x) => x.distance !== undefined && x.distance <= radius)
    : withDistance;

  filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  return toCursorPage(
    filtered.map((x) => x.row),
    query.limit,
    (row) => serialisePharmacy(row, filtered.find((x) => x.row.id === row.id)?.distance),
  );
}

/**
 * A prescription is not treatment; obtaining the medicine is. When the point
 * of care has none, this answers where it is — with distance and stock
 * status visible before the patient travels, rather than after.
 */
export async function searchMedication(input: {
  medication_name: string; lat: number; lng: number; radius_km?: number;
}) {
  const radius = input.radius_km ?? 15;

  const stock = await prisma.pharmacyStock.findMany({
    where: {
      medicationName: { contains: input.medication_name, mode: 'insensitive' },
      pharmacy: { isVerified: true, isActive: true },
    },
    include: { pharmacy: true },
    take: 200,
  });

  const withDistance = stock
    .map((s) => ({
      stock: s,
      distance:
        s.pharmacy.lat != null && s.pharmacy.lng != null
          ? haversineKm(input.lat, input.lng, s.pharmacy.lat, s.pharmacy.lng)
          : undefined,
    }))
    .filter((x) => x.distance !== undefined && x.distance <= radius)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  return {
    data: withDistance.map(({ stock: s, distance }) => ({
      pharmacy: serialisePharmacy(s.pharmacy, distance),
      medication_name: s.medicationName,
      stock_status: s.stockStatus,
      unit_price: s.unitPrice ? Number(s.unitPrice) : null,
      currency: s.currency,
      // Stock data ages fast. A stale figure sends someone on a journey for
      // nothing, so the age travels with the answer.
      last_reported_at: s.lastReportedAt.toISOString(),
    })),
  };
}
TS

# --- dispensing service --------------------------------------------------
cat > "$SVC/src/services/dispensing.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { conflict, forbidden, notFound, sha256, unauthenticated, unprocessable } from '@a-health/http';
import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function generateCode(): string {
  // Six digits, same shape as the OTP — easy to read aloud at a counter, hard
  // to guess within the short window it is valid for.
  let out = '';
  for (let i = 0; i < 6; i += 1) out += randomInt(0, 10).toString();
  return out;
}

/**
 * Issues a short-lived, single-pharmacy-redeemable code for a prescription.
 *
 * Restricted to the prescription's owner or their guardian, or the
 * prescriber — a stranger must not be able to mint a code for someone else's
 * medication. Only an active prescription can be coded; a completed or
 * discontinued one has nothing left to dispense.
 */
export async function issueDispenseCode(prescriptionId: string, caller: Caller, meta: Meta) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!prescription) throw notFound('Prescription not found');

  const owns =
    prescription.patient.userId === caller.sub ||
    prescription.patient.guardianUserId === caller.sub ||
    prescription.prescribedById === caller.cpid;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot issue a dispense code for this prescription');
  }
  if (prescription.status !== 'active') {
    throw conflict('PRESCRIPTION_NOT_ACTIVE', 'This prescription is not active');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + env.DISPENSE_CODE_TTL_HOURS * 3_600_000);

  await prisma.dispenseCode.create({
    data: { prescriptionId, codeHash: sha256(code), expiresAt },
  });

  return { code, expires_at: expiresAt.toISOString(), prescription_id: prescriptionId };
}

/**
 * Redeems a code at the counter. Deliberately narrow output: items, dose and
 * prescriber — never the diagnosis. A pharmacist needs the medication, not
 * the condition; role-based access is the point.
 *
 * The conditional update (`redeemedAt: null`) is the single-use guarantee,
 * same pattern as OTP and the realtime ticket: a concurrent second redemption
 * loses the race and is told the code is already used, rather than both
 * succeeding.
 */
export async function verifyDispenseCode(code: string, pharmacyId: string | undefined, caller: Caller) {
  if (caller.role !== 'pharmacist' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a pharmacist may redeem a dispense code');
  }

  const row = await prisma.dispenseCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code is not valid');
  if (row.expiresAt < new Date()) throw unauthenticated('DISPENSE_CODE_EXPIRED', 'Code has expired');
  if (row.redeemedAt) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code has already been used');

  const burned = await prisma.dispenseCode.updateMany({
    where: { id: row.id, redeemedAt: null },
    data: { redeemedAt: new Date(), pharmacyId: pharmacyId ?? null },
  });
  if (burned.count !== 1) throw unauthenticated('DISPENSE_CODE_INVALID', 'Code has already been used');

  const prescription = await prisma.prescription.findUniqueOrThrow({
    where: { id: row.prescriptionId },
    include: {
      items: true,
      patient: { select: { fullName: true } },
      prescribedBy: { include: { user: { select: { fullName: true } } } },
    },
  });

  const dispensing = await prisma.dispensingRecord.create({
    data: {
      prescriptionId: prescription.id,
      pharmacyId: pharmacyId ?? row.pharmacyId ?? undefined,
      pharmacistUserId: caller.sub,
      status: 'pending',
    },
  });

  return {
    dispensing_id: dispensing.id,
    prescription_id: prescription.id,
    // No diagnosis field anywhere in this view — by omission, not by filtering.
    patient_display_name: prescription.patient.fullName,
    prescribed_by: prescription.prescribedBy.user.fullName ?? 'Unknown clinician',
    prescribed_at: prescription.createdAt.toISOString(),
    items: prescription.items.map((i) => ({
      id: i.id,
      medication_name: i.medicationName,
      dosage: i.dosage,
      frequency_per_day: i.frequencyPerDay,
      duration_days: i.durationDays,
      instructions: i.instructions,
    })),
  };
}

/**
 * Records what was actually handed over. Substitution requires pharmacist
 * review and a named approver — the platform never permits silent
 * substitution, enforced here rather than left as a UI convention.
 */
export async function completeDispensing(
  dispensingId: string,
  caller: Caller,
  items: { prescription_item_id: string; quantity_dispensed: number; substituted_with?: string; substitution_approved_by?: string }[],
) {
  const dispensing = await prisma.dispensingRecord.findUnique({ where: { id: dispensingId } });
  if (!dispensing) throw notFound('Dispensing record not found');
  if (dispensing.pharmacistUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'You did not open this dispensing');
  }
  if (dispensing.status === 'complete') {
    throw conflict('STATE_TRANSITION_INVALID', 'This dispensing is already complete');
  }

  for (const item of items) {
    if (item.substituted_with && !item.substitution_approved_by) {
      throw unprocessable(
        'A substitution requires an approving clinician',
        'items.substitution_approved_by',
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.dispensingItem.createMany({
      data: items.map((i) => ({
        dispensingId,
        prescriptionItemId: i.prescription_item_id,
        quantityDispensed: i.quantity_dispensed,
        substitutedWith: i.substituted_with ?? null,
        substitutionApprovedBy: i.substitution_approved_by ?? null,
      })),
    });

    const prescriptionItems = await tx.prescriptionItem.findMany({
      where: { prescriptionId: dispensing.prescriptionId },
    });
    const complete = items.length >= prescriptionItems.length;

    return tx.dispensingRecord.update({
      where: { id: dispensingId },
      data: { status: complete ? 'complete' : 'partial', dispensedAt: new Date(), version: { increment: 1 } },
    });
  });

  return {
    id: updated.id,
    prescription_id: updated.prescriptionId,
    status: updated.status,
    dispensed_at: updated.dispensedAt?.toISOString() ?? null,
    version: updated.version,
  };
}
TS

# --- types -----------------------------------------------------------------
cat > "$SVC/src/types/pharmacy.types.ts" << 'TS'
import { z } from 'zod';

export const listPharmaciesQuery = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius_km: z.coerce.number().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const searchMedicationQuery = z.object({
  medication_name: z.string().min(1),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius_km: z.coerce.number().optional(),
});

export const verifyDispenseCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  pharmacy_id: z.string().uuid().optional(),
});

export const completeDispensingSchema = z.object({
  items: z.array(z.object({
    prescription_item_id: z.string().uuid(),
    quantity_dispensed: z.number().int().min(1),
    substituted_with: z.string().max(150).optional(),
    substitution_approved_by: z.string().uuid().optional(),
  })).min(1),
});
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/pharmacy.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as pharmacies from '../services/pharmacy.service.js';
import * as dispensing from '../services/dispensing.service.js';
import {
  completeDispensingSchema, listPharmaciesQuery, searchMedicationQuery, verifyDispenseCodeSchema,
} from '../types/pharmacy.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listPharmacies = handle((req) => pharmacies.listPharmacies(listPharmaciesQuery.parse(req.query)));

export const searchMedication = handle((req) => pharmacies.searchMedication(searchMedicationQuery.parse(req.query)));

export const issueDispenseCode = handle(
  (req, res) => dispensing.issueDispenseCode(pathParam(req, 'prescription_id'), caller(req), meta(req, res)), 201,
);

export const verifyDispenseCode = handle((req) => {
  const input = verifyDispenseCodeSchema.parse(req.body);
  return dispensing.verifyDispenseCode(input.code, input.pharmacy_id, caller(req));
});

export const completeDispensing = handle((req) => {
  const input = completeDispensingSchema.parse(req.body);
  return dispensing.completeDispensing(pathParam(req, 'dispensing_id'), caller(req), input.items);
});
TS

cat > "$SVC/src/routes/pharmacy.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/pharmacy.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const pharmacyRouter = Router();

pharmacyRouter.get('/pharmacies', requireAuth, c.listPharmacies);
pharmacyRouter.get('/pharmacies/medication-search', requireAuth, c.searchMedication);

pharmacyRouter.post('/prescriptions/:prescription_id/dispense-code', requireAuth, idempotency, c.issueDispenseCode);
pharmacyRouter.post('/dispensing/verify', requireAuth, idempotency, c.verifyDispenseCode);
pharmacyRouter.post('/dispensing/:dispensing_id/complete', requireAuth, idempotency, c.completeDispensing);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { pharmacyRouter } from './routes/pharmacy.routes.js';

const service = createService({
  name: 'pharmacy',
  port: env.PORT,
  routers: [pharmacyRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4011"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/pharmacy.test.ts" << 'TS'
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

after(async () => {
  for (const id of prescriptionIds) {
    await prisma.dispensingItem.deleteMany({ where: { dispensing: { prescriptionId: id } } }).catch(() => undefined);
    await prisma.dispensingRecord.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.dispenseCode.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
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
      () => dispensing.verifyDispenseCode(issued.code, undefined, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses an unknown code', async () => {
    const pharmacist = await makePharmacist();
    await assert.rejects(
      () => dispensing.verifyDispenseCode('000000', undefined, { sub: pharmacist.id, role: 'pharmacist' }),
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
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/pharmacy exec tsc --noEmit"
echo "  pnpm --filter @a-health/pharmacy test"
