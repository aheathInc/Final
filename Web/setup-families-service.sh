#!/usr/bin/env bash
#
# Builds services/families — the "One Family, One Doctor" subscription
# model (blueprint §20). Two clinicians are assigned per family, not one:
# a GP for general continuity, and a separate OB/GYN for maternal and
# reproductive care — routing pregnancy through whoever happens to be free
# is exactly what this pairing exists to prevent.
#
# Run from the repo root:
#   bash setup-families-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/families"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in DUPLICATE_RESOURCE CLINICIAN_UNAVAILABLE CLINICIAN_NOT_VERIFIED NOT_FOUND FORBIDDEN ROLE_NOT_PERMITTED; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/families';
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
  PORT: z.coerce.number().default(4015),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/families.types.ts" << 'TS'
import { z } from 'zod';

export const createFamilySchema = z.object({
  name: z.string().min(1).max(150),
  subscription_tier: z.enum(['none', 'family_basic', 'family_plus']).optional(),
});

export const addMemberSchema = z.object({
  patient_profile_id: z.string().uuid(),
  relationship: z.enum(['head', 'spouse', 'child', 'parent', 'sibling', 'dependant', 'other']),
});

export const assignDoctorsSchema = z.object({
  gp_clinician_id: z.string().uuid().optional(),
  obgyn_clinician_id: z.string().uuid().optional(),
}).refine((v) => v.gp_clinician_id || v.obgyn_clinician_id, {
  message: 'At least one of gp_clinician_id or obgyn_clinician_id is required',
});
TS

# --- service --------------------------------------------------------------
cat > "$SVC/src/services/family.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseFamily(f: { id: string; name: string; subscriptionTier: string; version: number; createdAt: Date }) {
  return {
    id: f.id,
    name: f.name,
    subscription_tier: f.subscriptionTier,
    created_at: f.createdAt.toISOString(),
    version: f.version,
  };
}

/** Creates a family. The caller becomes its head — the account that can add members and later hand off assignment to admin. */
export async function createFamily(caller: Caller, input: { name: string; subscription_tier?: string }, meta: Meta) {
  const family = await prisma.family.create({
    data: {
      name: input.name,
      subscriptionTier: (input.subscription_tier ?? 'none') as never,
      headUserId: caller.sub,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.created',
    entityType: 'families', entityId: family.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseFamily(family);
}

/**
 * The caller's own family: as head, or as a member via any patient profile
 * they own or guard. Returns members and both doctor assignments together —
 * this is the one view a family actually reads day to day.
 */
export async function getMyFamily(caller: Caller) {
  const guardedProfiles = await prisma.patientProfile.findMany({
    where: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] },
    select: { id: true },
  });
  const profileIds = guardedProfiles.map((p) => p.id);

  const family = await prisma.family.findFirst({
    where: {
      OR: [
        { headUserId: caller.sub },
        ...(profileIds.length > 0 ? [{ members: { some: { patientProfileId: { in: profileIds } } } }] : []),
      ],
    },
    include: {
      members: { include: { patient: { select: { fullName: true } } } },
      assignments: {
        include: {
          gp: { include: { user: { select: { fullName: true } } } },
          obgyn: { include: { user: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!family) throw notFound('You do not belong to a family');

  const assignment = family.assignments[0];

  return {
    ...serialiseFamily(family),
    members: family.members.map((m) => ({
      id: m.id,
      patient_profile_id: m.patientProfileId,
      full_name: m.patient.fullName,
      relationship: m.relationship,
    })),
    gp_clinician: assignment?.gp
      ? { id: assignment.gp.id, full_name: assignment.gp.user.fullName, current_family_load: assignment.gp.familyLoad }
      : null,
    obgyn_clinician: assignment?.obgyn
      ? { id: assignment.obgyn.id, full_name: assignment.obgyn.user.fullName, current_family_load: assignment.obgyn.familyLoad }
      : null,
  };
}

async function assertHead(familyId: string, caller: Caller) {
  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) throw notFound('Family not found');
  if (family.headUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'Only the family head may do this');
  }
  return family;
}

/** Adding a member is a head-of-family action. Uniqueness on (family, patient) is enforced by the schema itself. */
export async function addFamilyMember(
  familyId: string, caller: Caller, input: { patient_profile_id: string; relationship: string }, meta: Meta,
) {
  await assertHead(familyId, caller);

  const patient = await prisma.patientProfile.findUnique({ where: { id: input.patient_profile_id } });
  if (!patient) throw notFound('Patient profile not found');

  const existing = await prisma.familyMember.findFirst({
    where: { familyId, patientProfileId: input.patient_profile_id },
  });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'This patient is already a member of the family');

  const member = await prisma.familyMember.create({
    data: { familyId, patientProfileId: input.patient_profile_id, relationship: input.relationship as never },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.member_added',
    entityType: 'family_members', entityId: member.id,
    metadata: { familyId, patientProfileId: input.patient_profile_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return {
    id: member.id,
    family_id: member.familyId,
    patient_profile_id: member.patientProfileId,
    full_name: patient.fullName,
    relationship: member.relationship,
  };
}

/**
 * Assigns the family's GP and/or OB/GYN. Admin-only: matching a family to a
 * clinician's panel is an operational decision, drawing on the
 * employed-clinician roster with a bounded number of families each — not
 * something a family head picks for themselves.
 *
 * Reassigning releases the previous clinician's load before claiming the
 * new one's, so a family moving between doctors never double-counts against
 * either panel.
 */
export async function assignFamilyDoctors(
  familyId: string, caller: Caller,
  input: { gp_clinician_id?: string; obgyn_clinician_id?: string }, meta: Meta,
) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only an admin may assign family doctors');
  }

  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) throw notFound('Family not found');

  const existing = await prisma.familyAssignment.findUnique({ where: { familyId } });

  async function claim(clinicianId: string, specialtyLabel: string) {
    const clinician = await prisma.clinicianProfile.findUnique({ where: { id: clinicianId } });
    if (!clinician) throw notFound(`${specialtyLabel} clinician not found`);
    if (clinician.verificationStatus !== 'verified') {
      throw forbidden('CLINICIAN_NOT_VERIFIED', `${specialtyLabel} clinician is not verified`);
    }
    if (clinician.maxFamilyLoad > 0 && clinician.familyLoad >= clinician.maxFamilyLoad) {
      throw conflict('CLINICIAN_UNAVAILABLE', `${specialtyLabel} clinician has no family capacity remaining`);
    }
  }

  if (input.gp_clinician_id) await claim(input.gp_clinician_id, 'GP');
  if (input.obgyn_clinician_id) await claim(input.obgyn_clinician_id, 'OB/GYN');

  const updated = await prisma.$transaction(async (tx) => {
    if (input.gp_clinician_id) {
      if (existing?.gpClinicianId && existing.gpClinicianId !== input.gp_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: existing.gpClinicianId }, data: { familyLoad: { decrement: 1 } } });
      }
      if (existing?.gpClinicianId !== input.gp_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: input.gp_clinician_id }, data: { familyLoad: { increment: 1 } } });
      }
    }
    if (input.obgyn_clinician_id) {
      if (existing?.obgynClinicianId && existing.obgynClinicianId !== input.obgyn_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: existing.obgynClinicianId }, data: { familyLoad: { decrement: 1 } } });
      }
      if (existing?.obgynClinicianId !== input.obgyn_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: input.obgyn_clinician_id }, data: { familyLoad: { increment: 1 } } });
      }
    }

    return tx.familyAssignment.upsert({
      where: { familyId },
      create: {
        familyId,
        gpClinicianId: input.gp_clinician_id ?? null,
        obgynClinicianId: input.obgyn_clinician_id ?? null,
      },
      update: {
        ...(input.gp_clinician_id ? { gpClinicianId: input.gp_clinician_id } : {}),
        ...(input.obgyn_clinician_id ? { obgynClinicianId: input.obgyn_clinician_id } : {}),
        version: { increment: 1 },
      },
      include: {
        gp: { include: { user: { select: { fullName: true } } } },
        obgyn: { include: { user: { select: { fullName: true } } } },
      },
    });
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.doctors_assigned',
    entityType: 'family_assignments', entityId: updated.id,
    metadata: { familyId, gpClinicianId: input.gp_clinician_id ?? null, obgynClinicianId: input.obgyn_clinician_id ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  const familyRow = await prisma.family.findUniqueOrThrow({
    where: { id: familyId },
    include: { members: { include: { patient: { select: { fullName: true } } } } },
  });

  return {
    ...serialiseFamily(familyRow),
    members: familyRow.members.map((m) => ({
      id: m.id, patient_profile_id: m.patientProfileId, full_name: m.patient.fullName, relationship: m.relationship,
    })),
    gp_clinician: updated.gp
      ? { id: updated.gp.id, full_name: updated.gp.user.fullName, current_family_load: updated.gp.familyLoad }
      : null,
    obgyn_clinician: updated.obgyn
      ? { id: updated.obgyn.id, full_name: updated.obgyn.user.fullName, current_family_load: updated.obgyn.familyLoad }
      : null,
  };
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/families.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as families from '../services/family.service.js';
import { addMemberSchema, assignDoctorsSchema, createFamilySchema } from '../types/families.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req, res) => families.createFamily(caller(req), createFamilySchema.parse(req.body), meta(req, res)), 201,
);

export const getMine = handle((req) => families.getMyFamily(caller(req)));

export const addMember = handle(
  (req, res) => families.addFamilyMember(pathParam(req, 'family_id'), caller(req), addMemberSchema.parse(req.body), meta(req, res)),
  201,
);

export const assignDoctors = handle(
  (req, res) => families.assignFamilyDoctors(pathParam(req, 'family_id'), caller(req), assignDoctorsSchema.parse(req.body), meta(req, res)),
);
TS

cat > "$SVC/src/routes/families.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/families.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const familiesRouter = Router();

familiesRouter.post('/families', requireAuth, idempotency, c.create);
familiesRouter.get('/families/me', requireAuth, c.getMine);
familiesRouter.post('/families/:family_id/members', requireAuth, idempotency, c.addMember);
familiesRouter.post('/families/:family_id/assignments', requireAuth, idempotency, c.assignDoctors);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { familiesRouter } from './routes/families.routes.js';

const service = createService({
  name: 'families',
  port: env.PORT,
  routers: [familiesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4015"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/families.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as families from '../services/family.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const familyIds: string[] = [];

after(async () => {
  for (const id of familyIds) {
    await prisma.familyAssignment.deleteMany({ where: { familyId: id } }).catch(() => undefined);
    await prisma.familyMember.deleteMany({ where: { familyId: id } }).catch(() => undefined);
    await prisma.family.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Family Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Family Test' } });
  return { user, profile };
}

async function makeClinician(maxFamilyLoad = 10) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Family Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified', maxFamilyLoad },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('creating and viewing', () => {
  it('creates a family with the caller as head, and getMyFamily finds it', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'The Test Family' }, meta);
    familyIds.push(family.id);

    const mine = await families.getMyFamily({ sub: user.id, role: 'patient' });
    assert.equal(mine.id, family.id);
    assert.equal(mine.members.length, 0);
  });

  it('refuses a caller with no family', async () => {
    await assert.rejects(
      () => families.getMyFamily({ sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_FOUND',
    );
  });
});

describe('membership', () => {
  it('lets the head add a member', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Add Member Family' }, meta);
    familyIds.push(family.id);
    const { profile: childProfile } = await makePatient();

    const member = await families.addFamilyMember(
      family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: childProfile.id, relationship: 'child' }, meta,
    );
    assert.equal(member.relationship, 'child');

    const mine = await families.getMyFamily({ sub: user.id, role: 'patient' });
    assert.equal(mine.members.length, 1);
  });

  it('refuses a non-head adding a member', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'No Access Family' }, meta);
    familyIds.push(family.id);
    const { profile: other } = await makePatient();

    await assert.rejects(
      () => families.addFamilyMember(family.id, { sub: randomUUID(), role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses adding the same patient twice', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Dup Family' }, meta);
    familyIds.push(family.id);
    const { profile: other } = await makePatient();
    await families.addFamilyMember(family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta);

    await assert.rejects(
      () => families.addFamilyMember(family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta),
      (e: AppError) => e.code === 'DUPLICATE_RESOURCE',
    );
  });
});

describe('doctor assignment', () => {
  it('assigns a separate GP and OB/GYN', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Assigned Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician();
    const obgyn = await makeClinician();

    const result = await families.assignFamilyDoctors(
      family.id, { sub: randomUUID(), role: 'platform_admin' },
      { gp_clinician_id: gp.id, obgyn_clinician_id: obgyn.id }, meta,
    );
    assert.equal(result.gp_clinician!.id, gp.id);
    assert.equal(result.obgyn_clinician!.id, obgyn.id);
    assert.notEqual(result.gp_clinician!.id, result.obgyn_clinician!.id);

    const reloadedGp = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: gp.id } });
    assert.equal(reloadedGp.familyLoad, 1);
  });

  it('refuses a non-admin assigning doctors', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Blocked Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician();

    await assert.rejects(
      () => families.assignFamilyDoctors(family.id, { sub: user.id, role: 'patient' }, { gp_clinician_id: gp.id }, meta),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses assigning a clinician at family-load capacity', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Full Panel Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician(1);

    const other = await makePatient();
    const otherFamily = await families.createFamily({ sub: other.user.id, role: 'patient' }, { name: 'Other Family' }, meta);
    familyIds.push(otherFamily.id);
    await families.assignFamilyDoctors(otherFamily.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: gp.id }, meta);

    await assert.rejects(
      () => families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: gp.id }, meta),
      (e: AppError) => e.code === 'CLINICIAN_UNAVAILABLE',
    );
  });

  it('releases the previous clinician\u2019s load on reassignment', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Reassign Family' }, meta);
    familyIds.push(family.id);
    const firstGp = await makeClinician();
    const secondGp = await makeClinician();

    await families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: firstGp.id }, meta);
    await families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: secondGp.id }, meta);

    const reloadedFirst = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: firstGp.id } });
    const reloadedSecond = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: secondGp.id } });
    assert.equal(reloadedFirst.familyLoad, 0);
    assert.equal(reloadedSecond.familyLoad, 1);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/families exec tsc --noEmit"
echo "  pnpm --filter @a-health/families test"
