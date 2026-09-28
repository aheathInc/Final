#!/usr/bin/env bash
#
# Builds services/insurance — coverage checks and claims (blueprint §18).
# Access is incomplete when a patient can find care but cannot afford it.
#
# Run from the repo root:
#   bash setup-insurance-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/insurance"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in STATE_TRANSITION_INVALID NOT_RESOURCE_OWNER ROLE_NOT_PERMITTED NOT_FOUND FORBIDDEN VALIDATION_FAILED; do
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
pkg.name = pkg.name || '@a-health/insurance';
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
  PORT: z.coerce.number().default(4018),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/insurance.types.ts" << 'TS'
import { z } from 'zod';

export const getCoverageQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  facility_id: z.string().uuid().optional(),
});

export const submitClaimSchema = z.object({
  consultation_id: z.string().uuid(),
  scheme_id: z.string().uuid(),
  item_codes: z.array(z.string()).optional(),
});

export const listClaimsQuery = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected', 'paid']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
TS

cat > "$SVC/src/services/insurance.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

/**
 * Coverage is incomplete when a patient can find care but cannot afford it.
 * This answers what is covered, by whom, and until when — before travelling,
 * not at the counter.
 *
 * `accepted_at_facility` is always null here: there is no facility-scheme
 * acceptance mapping in the schema yet. Returning null is honest; guessing
 * would not be.
 */
export async function getCoverage(caller: Caller, patientProfileId: string | undefined) {
  const targetId = patientProfileId ?? caller.ppid;
  if (!targetId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');

  const patient = await prisma.patientProfile.findUnique({ where: { id: targetId } });
  if (!patient) throw notFound('Patient profile not found');
  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot check coverage for this patient');
  }

  const memberships = await prisma.insuranceMembership.findMany({
    where: { patientProfileId: targetId },
    include: { scheme: { select: { id: true, name: true } } },
  });

  return {
    patient_profile_id: targetId,
    schemes: memberships.map((m) => ({
      scheme_id: m.scheme.id,
      scheme_name: m.scheme.name,
      membership_number: m.membershipNumber,
      status: m.status,
      accepted_at_facility: null,
      covered_services: m.coveredServices ?? [],
      valid_until: m.validUntil?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

function serialiseClaim(c: {
  id: string; consultationId: string; schemeId: string; status: string;
  itemCodes: unknown; amountClaimed: unknown; amountPaid: unknown; currency: string | null;
  rejectionReason: string | null; submittedAt: Date; decidedAt: Date | null; version: number;
}) {
  return {
    id: c.id,
    consultation_id: c.consultationId,
    scheme_id: c.schemeId,
    status: c.status,
    item_codes: c.itemCodes ?? [],
    rejection_reason: c.rejectionReason,
    submitted_at: c.submittedAt.toISOString(),
    decided_at: c.decidedAt?.toISOString() ?? null,
    version: c.version,
  };
}

/**
 * Submitted by the consultation's own clinician, or an admin — billing is
 * initiated by the provider who delivered the care, not by the patient.
 * Requires an active membership in the named scheme; a claim against a
 * scheme the patient does not belong to is rejected before it is ever
 * created, not after.
 */
export async function submitClaim(
  caller: Caller, input: { consultation_id: string; scheme_id: string; item_codes?: string[] }, meta: Meta,
) {
  const consultation = await prisma.consultationRequest.findUnique({ where: { id: input.consultation_id } });
  if (!consultation) throw notFound('Consultation not found');
  if (caller.role !== 'platform_admin' && consultation.assignedClinicianId !== caller.cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You did not deliver this consultation');
  }

  const scheme = await prisma.insuranceScheme.findUnique({ where: { id: input.scheme_id } });
  if (!scheme) throw notFound('Insurance scheme not found');

  const membership = await prisma.insuranceMembership.findFirst({
    where: { schemeId: input.scheme_id, patientProfileId: consultation.patientProfileId, status: 'active' },
  });
  if (!membership) {
    throw conflict('STATE_TRANSITION_INVALID', 'This patient has no active membership in that scheme');
  }

  const claim = await prisma.insuranceClaim.create({
    data: {
      consultationId: input.consultation_id,
      schemeId: input.scheme_id,
      itemCodes: (input.item_codes ?? []) as never,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'insurance.claim_submitted',
    entityType: 'insurance_claims', entityId: claim.id,
    metadata: { consultationId: input.consultation_id, schemeId: input.scheme_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseClaim(claim);
}

export async function listClaims(
  caller: Caller, query: { status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { consultation: { assignedClinicianId: caller.cpid } }
        : { consultation: { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } } };

  const rows = await prisma.insuranceClaim.findMany({
    where: { ...scope, ...(query.status ? { status: query.status as never } : {}) },
    orderBy: { submittedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseClaim);
}
TS

cat > "$SVC/src/controllers/insurance.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import * as insurance from '../services/insurance.service.js';
import { getCoverageQuery, listClaimsQuery, submitClaimSchema } from '../types/insurance.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getCoverage = handle((req) => {
  const query = getCoverageQuery.parse(req.query);
  return insurance.getCoverage(caller(req), query.patient_profile_id);
});

export const submitClaim = handle(
  (req, res) => insurance.submitClaim(caller(req), submitClaimSchema.parse(req.body), meta(req, res)), 202,
);

export const listClaims = handle((req) => insurance.listClaims(caller(req), listClaimsQuery.parse(req.query)));
TS

cat > "$SVC/src/routes/insurance.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/insurance.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const insuranceRouter = Router();

insuranceRouter.get('/insurance/coverage', requireAuth, c.getCoverage);
insuranceRouter.post('/insurance/claims', requireAuth, idempotency, c.submitClaim);
insuranceRouter.get('/insurance/claims', requireAuth, c.listClaims);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { insuranceRouter } from './routes/insurance.routes.js';

const service = createService({
  name: 'insurance',
  port: env.PORT,
  routers: [insuranceRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4018"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/insurance.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as insurance from '../services/insurance.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const schemeIds: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const claimIds: string[] = [];

after(async () => {
  for (const id of claimIds) {
    await prisma.insuranceClaim.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.consultationRequest.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of schemeIds) {
    await prisma.insuranceMembership.deleteMany({ where: { schemeId: id } }).catch(() => undefined);
    await prisma.insuranceScheme.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Ins Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Ins Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Ins Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeScheme() {
  const scheme = await prisma.insuranceScheme.create({ data: { name: `Scheme ${randomUUID().slice(0, 8)}`, code: `S${randomUUID().slice(0, 6)}` } });
  schemeIds.push(scheme.id);
  return scheme;
}

async function makeConsultation(patientProfileId: string, clinicianId: string) {
  const thread = await prisma.careThread.create({ data: { patientProfileId } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  return consultation;
}

describe('coverage', () => {
  it('lists an active membership', async () => {
    const { user, profile } = await makePatient();
    const scheme = await makeScheme();
    await prisma.insuranceMembership.create({
      data: { schemeId: scheme.id, patientProfileId: profile.id, membershipNumber: 'M-1', status: 'active' },
    });

    const result = await insurance.getCoverage({ sub: user.id, role: 'patient' }, profile.id);
    assert.equal(result.schemes.length, 1);
    assert.equal(result.schemes[0]!.status, 'active');
  });

  it('refuses a stranger checking someone else\u2019s coverage', async () => {
    const { profile } = await makePatient();
    await assert.rejects(
      () => insurance.getCoverage({ sub: randomUUID(), role: 'patient' }, profile.id),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('claims', () => {
  it('submits a claim for an active member', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const scheme = await makeScheme();
    await prisma.insuranceMembership.create({
      data: { schemeId: scheme.id, patientProfileId: profile.id, membershipNumber: 'M-2', status: 'active' },
    });
    const consultation = await makeConsultation(profile.id, clinician.id);

    const claim = await insurance.submitClaim(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
    );
    claimIds.push(claim.id);
    assert.equal(claim.status, 'submitted');
  });

  it('refuses a claim with no active membership', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const scheme = await makeScheme();
    const consultation = await makeConsultation(profile.id, clinician.id);

    await assert.rejects(
      () => insurance.submitClaim(
        { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
        { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses a clinician submitting for a consultation that is not theirs', async () => {
    const { profile } = await makePatient();
    const owner = await makeClinician();
    const stranger = await makeClinician();
    const scheme = await makeScheme();
    const consultation = await makeConsultation(profile.id, owner.id);

    await assert.rejects(
      () => insurance.submitClaim(
        { sub: randomUUID(), role: 'clinician', cpid: stranger.id },
        { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
      ),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/insurance exec tsc --noEmit"
echo "  pnpm --filter @a-health/insurance test"
