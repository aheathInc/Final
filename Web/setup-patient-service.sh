#!/usr/bin/env bash
#
# Builds services/patient — patient profiles, dependants, and consent.
#
# Small, and it closes a gap left open since auth: GET/POST
# /users/me/dependents was deliberately deferred here, because this service
# owns clinical profile data, not identity.
#
# Run from the repo root:
#   bash setup-patient-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/patient"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/patient';
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
  PORT: z.coerce.number().default(4002),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** A guardian may add at most this many dependants. Not a hard product limit — a brake on mistakes and abuse. */
  MAX_DEPENDENTS_PER_GUARDIAN: z.coerce.number().default(12),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/patient.types.ts" << 'TS'
import { z } from 'zod';

export const sex = z.enum(['male', 'female', 'other']);

export const geoPoint = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy_metres: z.number().optional(),
});

export const createDependentSchema = z.object({
  full_name: z.string().min(1).max(150),
  date_of_birth: z.string().date(),
  sex,
  chronic_conditions: z.array(z.string()).max(50).optional(),
  allergies: z.array(z.string()).max(50).optional(),
});

export const updateProfileSchema = z.object({
  base_version: z.number().int(),
  full_name: z.string().min(1).max(150).optional(),
  date_of_birth: z.string().date().optional(),
  sex: sex.optional(),
  blood_type: z.string().max(5).optional(),
  chronic_conditions: z.array(z.string()).max(50).optional(),
  allergies: z.array(z.string()).max(50).optional(),
  default_location: geoPoint.optional(),
  region_code: z.string().max(20).optional(),
});

export const grantConsentSchema = z.object({
  grantee_type: z.enum(['clinician', 'facility', 'researcher', 'emergency_responder']),
  grantee_clinician_id: z.string().uuid().optional(),
  grantee_facility_id: z.string().uuid().optional(),
  care_thread_id: z.string().uuid().optional(),
  scope: z.enum(['full_history', 'current_thread', 'medications_only', 'investigations_only', 'emergency_minimum']),
  expires_at: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

export const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateDependentInput = z.infer<typeof createDependentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type GrantConsentInput = z.infer<typeof grantConsentSchema>;
TS

cat > "$SVC/src/services/profile.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, recordChange } from '@a-health/http';
import { env } from '../config/env.js';
import type { CreateDependentInput, UpdateProfileInput } from '../types/patient.types.js';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

export function serialiseProfile(p: {
  id: string; userId: string | null; guardianUserId: string | null;
  fullName: string; dateOfBirth: Date | null; sex: string | null;
  chronicConditions: unknown; allergies: unknown; bloodType: string | null;
  defaultLat: number | null; defaultLng: number | null; regionCode: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: p.id,
    user_id: p.userId,
    guardian_user_id: p.guardianUserId,
    full_name: p.fullName,
    date_of_birth: p.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    sex: p.sex,
    chronic_conditions: p.chronicConditions ?? [],
    allergies: p.allergies ?? [],
    blood_type: p.bloodType,
    default_location: p.defaultLat != null && p.defaultLng != null
      ? { lat: p.defaultLat, lng: p.defaultLng }
      : null,
    region_code: p.regionCode,
    version: p.version,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

/** A patient reads and writes their own profile, or their guardian does. Nobody else. */
async function assertOwner(profileId: string, caller: Caller) {
  const profile = await prisma.patientProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound('Patient profile not found');
  const owns = profile.userId === caller.sub || profile.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This profile does not belong to you');
  }
  return profile;
}

export async function getProfile(profileId: string, caller: Caller) {
  const profile = await assertOwner(profileId, caller);
  return serialiseProfile(profile);
}

/**
 * Optimistic concurrency on every write. Two devices editing the same profile
 * offline — a common shape here — must not have one silently overwrite the
 * other; a stale base_version is rejected rather than merged blindly.
 */
export async function updateProfile(profileId: string, caller: Caller, input: UpdateProfileInput) {
  const current = await assertOwner(profileId, caller);
  if (current.version !== input.base_version) {
    throw conflict('VERSION_CONFLICT', 'This profile was changed elsewhere. Reload and retry.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.patientProfile.update({
      where: { id: profileId },
      data: {
        ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
        ...(input.date_of_birth !== undefined ? { dateOfBirth: new Date(input.date_of_birth) } : {}),
        ...(input.sex !== undefined ? { sex: input.sex as never } : {}),
        ...(input.blood_type !== undefined ? { bloodType: input.blood_type } : {}),
        ...(input.chronic_conditions !== undefined ? { chronicConditions: input.chronic_conditions as never } : {}),
        ...(input.allergies !== undefined ? { allergies: input.allergies as never } : {}),
        ...(input.default_location
          ? { defaultLat: input.default_location.lat, defaultLng: input.default_location.lng }
          : {}),
        ...(input.region_code !== undefined ? { regionCode: input.region_code } : {}),
        version: { increment: 1 },
      },
    });
    await recordChange(tx, {
      entity: 'patient_profiles', entityId: row.id, op: 'update',
      version: row.version, patientProfileId: row.id,
    });
    return row;
  });

  return serialiseProfile(updated);
}

/** Lists dependants under a guardian — the endpoint auth deliberately left for this service. */
export async function listDependents(guardianUserId: string, query: { cursor?: string; limit: number }) {
  const rows = await prisma.patientProfile.findMany({
    where: { guardianUserId },
    orderBy: { createdAt: 'asc' },
    take: query.limit,
  });
  return { data: rows.map(serialiseProfile) };
}

/**
 * A dependant profile has no login of its own. Every consultation raised for
 * one is attributed to the guardian's authenticated session plus the
 * dependant's patient_profile_id — never to a session the dependant holds,
 * because none exists.
 */
export async function createDependent(
  guardianUserId: string, input: CreateDependentInput, meta: Meta,
) {
  const count = await prisma.patientProfile.count({ where: { guardianUserId } });
  if (count >= env.MAX_DEPENDENTS_PER_GUARDIAN) {
    throw conflict('DUPLICATE_RESOURCE', 'Too many dependants on this account. Contact support to add more.');
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.patientProfile.create({
      data: {
        guardianUserId,
        fullName: input.full_name,
        dateOfBirth: new Date(input.date_of_birth),
        sex: input.sex as never,
        chronicConditions: (input.chronic_conditions ?? []) as never,
        allergies: (input.allergies ?? []) as never,
      },
    });
    await recordChange(tx, {
      entity: 'patient_profiles', entityId: row.id, op: 'create',
      version: row.version, patientProfileId: row.id,
    });
    return row;
  });

  await appendAudit({
    actorUserId: guardianUserId, action: 'dependent.created',
    entityType: 'patient_profiles', entityId: created.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseProfile(created);
}
TS

cat > "$SVC/src/services/consent.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound } from '@a-health/http';
import type { GrantConsentInput } from '../types/patient.types.js';
import type { Caller, Meta } from './profile.service.js';

function serialise(c: {
  id: string; patientProfileId: string; granteeType: string;
  granteeClinicianId: string | null; granteeFacilityId: string | null;
  careThreadId: string | null; scope: string; allowed: boolean;
  breakGlass: boolean; reason: string | null;
  grantedAt: Date; expiresAt: Date | null; revokedAt: Date | null;
  version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    patient_profile_id: c.patientProfileId,
    grantee_type: c.granteeType,
    grantee_clinician_id: c.granteeClinicianId,
    grantee_facility_id: c.granteeFacilityId,
    care_thread_id: c.careThreadId,
    scope: c.scope,
    allowed: c.allowed,
    break_glass: c.breakGlass,
    reason: c.reason,
    granted_at: c.grantedAt.toISOString(),
    expires_at: c.expiresAt?.toISOString() ?? null,
    revoked_at: c.revokedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function assertOwner(profileId: string, caller: Caller) {
  const profile = await prisma.patientProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound('Patient profile not found');
  const owns = profile.userId === caller.sub || profile.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This profile does not belong to you');
  }
  return profile;
}

/**
 * Who may see what. The blueprint's promise is that a patient controls this,
 * so every grant and revoke is both explicit and audited — this list is what
 * a "who has seen my records" screen reads from.
 */
export async function listConsents(profileId: string, caller: Caller) {
  await assertOwner(profileId, caller);
  const rows = await prisma.patientConsent.findMany({
    where: { patientProfileId: profileId, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  });
  return { data: rows.map(serialise) };
}

export async function grantConsent(
  profileId: string, caller: Caller, input: GrantConsentInput, meta: Meta,
) {
  await assertOwner(profileId, caller);

  const consent = await prisma.patientConsent.create({
    data: {
      patientProfileId: profileId,
      granteeType: input.grantee_type as never,
      granteeClinicianId: input.grantee_clinician_id ?? null,
      granteeFacilityId: input.grantee_facility_id ?? null,
      careThreadId: input.care_thread_id ?? null,
      scope: input.scope as never,
      reason: input.reason ?? null,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consent.granted',
    entityType: 'patient_consents', entityId: consent.id,
    metadata: { scope: input.scope, granteeType: input.grantee_type },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(consent);
}

/**
 * Revoke, never delete. The record that access was granted and later
 * withdrawn is itself part of the accountability trail the platform promises.
 */
export async function revokeConsent(profileId: string, consentId: string, caller: Caller, meta: Meta) {
  await assertOwner(profileId, caller);

  const consent = await prisma.patientConsent.findUnique({ where: { id: consentId } });
  if (!consent || consent.patientProfileId !== profileId) throw notFound('Consent not found');

  const updated = await prisma.patientConsent.update({
    where: { id: consentId },
    data: { allowed: false, revokedAt: new Date(), version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consent.revoked',
    entityType: 'patient_consents', entityId: consentId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(updated);
}
TS

cat > "$SVC/src/controllers/patient.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { notFound, pathParam } from '@a-health/http';
import * as profiles from '../services/profile.service.js';
import * as consents from '../services/consent.service.js';
import {
  createDependentSchema, grantConsentSchema, listQuery, updateProfileSchema,
} from '../types/patient.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getProfile = handle((req) =>
  profiles.getProfile(pathParam(req, 'patient_profile_id'), caller(req)));

export const getMyProfile = handle((req) => {
  const ppid = req.auth!.ppid;
  if (!ppid) throw notFound('No patient profile on this account');
  return profiles.getProfile(ppid, caller(req));
});

export const updateProfile = handle((req) =>
  profiles.updateProfile(pathParam(req, 'patient_profile_id'), caller(req), updateProfileSchema.parse(req.body)));

export const listDependents = handle((req) =>
  profiles.listDependents(req.auth!.sub, listQuery.parse(req.query)));

export const createDependent = handle(
  (req, res) => profiles.createDependent(req.auth!.sub, createDependentSchema.parse(req.body), meta(req, res)),
  201,
);

export const listConsents = handle((req) =>
  consents.listConsents(pathParam(req, 'patient_profile_id'), caller(req)));

export const grantConsent = handle(
  (req, res) => consents.grantConsent(
    pathParam(req, 'patient_profile_id'), caller(req), grantConsentSchema.parse(req.body), meta(req, res),
  ),
  201,
);

export const revokeConsent = handle((req, res) =>
  consents.revokeConsent(
    pathParam(req, 'patient_profile_id'), pathParam(req, 'consent_id'), caller(req), meta(req, res),
  ));
TS

cat > "$SVC/src/routes/patient.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/patient.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const patientRouter = Router();

// The endpoint auth left for this service: identity is one service's concern,
// clinical profile data is this one's.
patientRouter.get('/users/me/dependents', requireAuth, c.listDependents);
patientRouter.post('/users/me/dependents', requireAuth, idempotency, c.createDependent);

patientRouter.get('/patient-profiles/me', requireAuth, c.getMyProfile);
patientRouter.get('/patient-profiles/:patient_profile_id', requireAuth, c.getProfile);
patientRouter.patch('/patient-profiles/:patient_profile_id', requireAuth, c.updateProfile);

patientRouter.get('/patient-profiles/:patient_profile_id/consents', requireAuth, c.listConsents);
patientRouter.post('/patient-profiles/:patient_profile_id/consents', requireAuth, idempotency, c.grantConsent);
patientRouter.post('/patient-profiles/:patient_profile_id/consents/:consent_id/revoke', requireAuth, c.revokeConsent);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { patientRouter } from './routes/patient.routes.js';

const service = createService({
  name: 'patient',
  port: env.PORT,
  routers: [patientRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4002"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/patient.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as profiles from '../services/profile.service.js';
import * as consents from '../services/consent.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const createdUsers: string[] = [];
const createdProfiles: string[] = [];
const createdClinicians: string[] = [];

after(async () => {
  for (const id of createdProfiles) {
    await prisma.patientConsent.deleteMany({ where: { patientProfileId: id } }).catch(() => undefined);
    await prisma.changeLog.deleteMany({ where: { patientProfileId: id } }).catch(() => undefined);
    await prisma.patientProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdClinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUsers) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeGuardian() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient', status: 'active', fullName: 'Guardian Test',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Guardian Test' },
  });
  createdProfiles.push(profile.id);
  return { user, profile };
}

/** A real, minimally verified clinician — grantee_clinician_id is a foreign key, not a free-text field. */
async function makeClinician() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: 'clinician', status: 'active', fullName: 'Consent Test Clinician',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus: 'verified',
    },
  });
  createdClinicians.push(profile.id);
  return profile;
}

describe('profile ownership', () => {
  it('lets the owner read their own profile', async () => {
    const { user, profile } = await makeGuardian();
    const result = await profiles.getProfile(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(result.id, profile.id);
  });

  it('refuses a stranger', async () => {
    const { profile } = await makeGuardian();
    await assert.rejects(
      () => profiles.getProfile(profile.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('rejects a stale base_version', async () => {
    const { user, profile } = await makeGuardian();
    await assert.rejects(
      () => profiles.updateProfile(profile.id, { sub: user.id, role: 'patient' }, {
        base_version: profile.version - 1, full_name: 'Stale Name',
      }),
      (e: AppError) => e.code === 'VERSION_CONFLICT',
    );
  });

  it('increments version and records the change', async () => {
    const { user, profile } = await makeGuardian();
    const updated = await profiles.updateProfile(profile.id, { sub: user.id, role: 'patient' }, {
      base_version: profile.version, full_name: 'Renamed',
    });
    assert.equal(updated.version, profile.version + 1);

    const changes = await prisma.changeLog.count({ where: { patientProfileId: profile.id, op: 'update' } });
    assert.ok(changes >= 1);
  });
});

describe('dependants', () => {
  it('creates a dependant with no login of their own', async () => {
    const { user } = await makeGuardian();
    const dependent = await profiles.createDependent(user.id, {
      full_name: 'Baby Test', date_of_birth: '2024-01-01', sex: 'female',
    }, meta);
    createdProfiles.push(dependent.id);

    assert.equal(dependent.guardian_user_id, user.id);
    assert.equal(dependent.user_id, null);
  });

  it('lists only this guardian\'s dependants', async () => {
    const { user } = await makeGuardian();
    const other = await makeGuardian();

    const mine = await profiles.createDependent(user.id, {
      full_name: 'Mine', date_of_birth: '2020-01-01', sex: 'male',
    }, meta);
    createdProfiles.push(mine.id);
    const theirs = await profiles.createDependent(other.user.id, {
      full_name: 'Theirs', date_of_birth: '2020-01-01', sex: 'male',
    }, meta);
    createdProfiles.push(theirs.id);

    const result = await profiles.listDependents(user.id, { limit: 25 });
    assert.ok(result.data.some((d) => d.id === mine.id));
    assert.ok(!result.data.some((d) => d.id === theirs.id));
  });

  it('caps dependants per guardian', async () => {
    const { user } = await makeGuardian();
    for (let i = 0; i < 12; i += 1) {
      const d = await profiles.createDependent(user.id, {
        full_name: `Child ${i}`, date_of_birth: '2020-01-01', sex: 'male',
      }, meta);
      createdProfiles.push(d.id);
    }
    await assert.rejects(
      () => profiles.createDependent(user.id, {
        full_name: 'One Too Many', date_of_birth: '2020-01-01', sex: 'male',
      }, meta),
      (e: AppError) => e.code === 'DUPLICATE_RESOURCE',
    );
  });
});

describe('consent', () => {
  it('grants and lists a consent', async () => {
    const { user, profile } = await makeGuardian();
    const clinician = await makeClinician();
    await consents.grantConsent(profile.id, { sub: user.id, role: 'patient' }, {
      grantee_type: 'clinician',
      grantee_clinician_id: clinician.id,
      scope: 'current_thread',
    }, meta);

    const list = await consents.listConsents(profile.id, { sub: user.id, role: 'patient' });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0]!.scope, 'current_thread');
  });

  it('revoke marks disallowed rather than deleting the record', async () => {
    const { user, profile } = await makeGuardian();
    const granted = await consents.grantConsent(profile.id, { sub: user.id, role: 'patient' }, {
      grantee_type: 'researcher', scope: 'investigations_only',
    }, meta);

    const revoked = await consents.revokeConsent(profile.id, granted.id, { sub: user.id, role: 'patient' }, meta);
    assert.equal(revoked.allowed, false);
    assert.ok(revoked.revoked_at);

    // Revoked, not deleted — the row itself is part of the accountability trail.
    const stillExists = await prisma.patientConsent.findUnique({ where: { id: granted.id } });
    assert.ok(stillExists);
  });

  it('a stranger cannot grant consent on someone else\'s profile', async () => {
    const { profile } = await makeGuardian();
    await assert.rejects(
      () => consents.grantConsent(profile.id, { sub: randomUUID(), role: 'patient' }, {
        grantee_type: 'clinician', scope: 'full_history',
      }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/patient exec tsc --noEmit"
echo "  pnpm --filter @a-health/patient test"
