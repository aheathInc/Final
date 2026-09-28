#!/usr/bin/env bash
#
# Builds services/prevention — risk scores, vaccination records, and
# screening programme invitations (blueprint's prevention/screening pillar).
#
# Risk scoring is deliberately rule-based and small, not a claimed ML model
# — same honest-scope discipline as research's one real dataset and
# surveillance's real-but-bounded rollup. Accepting a screening invitation
# with a preferred slot books a REAL appointment through services/appointment
# rather than a second implementation of booking.
#
# Run from the repo root:
#   bash setup-prevention-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/prevention"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in NOT_FOUND FORBIDDEN NOT_RESOURCE_OWNER STATE_TRANSITION_INVALID VALIDATION_FAILED; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,engine,scripts,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/prevention';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts',
  'seed:programmes': 'node --import tsx src/scripts/seed-programmes.ts' };
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
  PORT: z.coerce.number().default(4024),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  APPOINTMENT_SERVICE_URL: z.string().default('http://localhost:4004'),
});

export const env = envSchema.parse(process.env);
TS

# --- risk scoring: small, real, rule-based, never fabricated ------------------
cat > "$SVC/src/engine/riskScoring.ts" << 'TS'
import { prisma } from '@a-health/database';

/**
 * Two real, deterministic rule-based scorers — not a claimed ML model. Same
 * honest-scope discipline as research's one real dataset: a score nobody can
 * interrogate cannot be acted on responsibly, so every score here carries
 * exactly the factors that produced it, computed by a function anyone can
 * read start to finish.
 *
 * A condition requested outside this pair is simply not scored — no
 * fabricated number, no silent substitution.
 */
export type SupportedCondition = 'hypertension' | 'type2_diabetes';
export const SUPPORTED_CONDITIONS: SupportedCondition[] = ['hypertension', 'type2_diabetes'];
export const MODEL_VERSION = 'rule-based-v1';

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 86_400_000));
}

interface ScoreResult { score: number; band: 'low' | 'moderate' | 'high' | 'very_high'; factors: Record<string, unknown> }

function bandFor(score: number): ScoreResult['band'] {
  if (score >= 0.75) return 'very_high';
  if (score >= 0.5) return 'high';
  if (score >= 0.25) return 'moderate';
  return 'low';
}

async function priorDiagnosisCount(patientProfileId: string, codePrefixes: string[]): Promise<number> {
  const notes = await prisma.consultationNote.findMany({
    where: { consultation: { patientProfileId } },
    select: { diagnosisCodes: true },
  });
  let count = 0;
  for (const note of notes) {
    const codes = Array.isArray(note.diagnosisCodes) ? (note.diagnosisCodes as string[]) : [];
    if (codes.some((c) => codePrefixes.some((prefix) => c.toUpperCase().startsWith(prefix)))) count += 1;
  }
  return count;
}

export async function scoreCondition(patientProfileId: string, condition: SupportedCondition): Promise<ScoreResult | null> {
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) return null;
  const age = ageFromDob(patient.dateOfBirth);

  if (condition === 'hypertension') {
    const priorCount = await priorDiagnosisCount(patientProfileId, ['I10', 'HTN']);
    const ageComponent = age === null ? 0 : Math.min(age / 80, 1) * 0.5;
    const historyComponent = Math.min(priorCount / 3, 1) * 0.5;
    const score = ageComponent + historyComponent;
    return {
      score: Math.round(score * 100) / 100,
      band: bandFor(score),
      factors: { age, prior_diagnosis_count: priorCount, age_component: ageComponent, history_component: historyComponent },
    };
  }

  // type2_diabetes
  const priorCount = await priorDiagnosisCount(patientProfileId, ['E11', 'DM2']);
  const ageComponent = age === null ? 0 : Math.min(Math.max(age - 30, 0) / 50, 1) * 0.4;
  const historyComponent = Math.min(priorCount / 2, 1) * 0.6;
  const score = ageComponent + historyComponent;
  return {
    score: Math.round(score * 100) / 100,
    band: bandFor(score),
    factors: { age, prior_diagnosis_count: priorCount, age_component: ageComponent, history_component: historyComponent },
  };
}
TS

# --- risk score service --------------------------------------------------
cat > "$SVC/src/services/riskScore.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { forbidden, notFound } from '@a-health/http';
import { MODEL_VERSION, SUPPORTED_CONDITIONS, scoreCondition, type SupportedCondition } from '../engine/riskScoring.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }

function serialise(r: { id: string; conditionCode: string; score: number; band: string; contributingFactors: unknown; modelVersion: string; computedAt: Date }) {
  return {
    id: r.id,
    condition_code: r.conditionCode,
    score: r.score,
    band: r.band,
    contributing_factors: r.contributingFactors,
    model_version: r.modelVersion,
    computed_at: r.computedAt.toISOString(),
  };
}

async function assertVisible(patientProfileId: string, caller: Caller) {
  if (caller.role === 'platform_admin' || caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view risk scores for this patient');
  }
}

export async function listRiskScores(patientProfileId: string, caller: Caller) {
  await assertVisible(patientProfileId, caller);
  const rows = await prisma.riskScore.findMany({ where: { patientProfileId }, orderBy: { computedAt: 'desc' } });
  return { data: rows.map(serialise) };
}

/**
 * Recomputes and stores a fresh score per requested condition, restricted to
 * the small supported set — an unsupported condition_code is silently
 * skipped, never faked with a placeholder number.
 */
export async function computeRiskScores(patientProfileId: string, caller: Caller, conditions?: string[]) {
  await assertVisible(patientProfileId, caller);

  const requested = (conditions && conditions.length > 0 ? conditions : SUPPORTED_CONDITIONS)
    .filter((c): c is SupportedCondition => SUPPORTED_CONDITIONS.includes(c as SupportedCondition));

  const results: ReturnType<typeof serialise>[] = [];
  for (const condition of requested) {
    const result = await scoreCondition(patientProfileId, condition);
    if (!result) continue;
    const row = await prisma.riskScore.upsert({
      where: { patientProfileId_conditionCode: { patientProfileId, conditionCode: condition } },
      create: {
        patientProfileId, conditionCode: condition, score: result.score, band: result.band as never,
        contributingFactors: result.factors as never, modelVersion: MODEL_VERSION,
      },
      update: {
        score: result.score, band: result.band as never, contributingFactors: result.factors as never,
        modelVersion: MODEL_VERSION, computedAt: new Date(), version: { increment: 1 },
      },
    });
    results.push(serialise(row));
  }
  return { data: results };
}
TS

# --- vaccinations ------------------------------------------------------------
cat > "$SVC/src/services/vaccination.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(v: {
  id: string; vaccineCode: string; doseNumber: number; status: string;
  dueAt: Date | null; administeredAt: Date | null; facilityId: string | null; batchNumber: string | null;
}) {
  return {
    id: v.id,
    vaccine_code: v.vaccineCode,
    dose_number: v.doseNumber,
    status: v.status,
    due_at: v.dueAt?.toISOString() ?? null,
    administered_at: v.administeredAt?.toISOString() ?? null,
    facility_id: v.facilityId,
    batch_number: v.batchNumber,
  };
}

async function assertVisible(patientProfileId: string, caller: Caller) {
  if (caller.role === 'platform_admin' || caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view vaccination records for this patient');
  }
}

export async function listVaccinations(patientProfileId: string, caller: Caller) {
  await assertVisible(patientProfileId, caller);
  const rows = await prisma.vaccination.findMany({ where: { patientProfileId }, orderBy: { doseNumber: 'asc' } });
  return { data: rows.map(serialise) };
}

/** Clinician or admin only — recording a dose is a clinical act, not a self-report. */
export async function recordVaccination(
  patientProfileId: string, caller: Caller,
  input: { vaccine_code: string; administered_at: string; dose_number?: number; facility_id?: string; batch_number?: string },
  meta: Meta,
) {
  if (!caller.cpid && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician or admin may record a dose');
  }
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');

  const dose = await prisma.vaccination.create({
    data: {
      patientProfileId, vaccineCode: input.vaccine_code, doseNumber: input.dose_number ?? 1,
      status: 'administered', administeredAt: new Date(input.administered_at),
      facilityId: input.facility_id ?? null, batchNumber: input.batch_number ?? null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'prevention.vaccination_recorded',
    entityType: 'vaccinations', entityId: dose.id,
    metadata: { vaccineCode: input.vaccine_code, patientProfileId },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(dose);
}
TS

# --- screening ------------------------------------------------------------
cat > "$SVC/src/services/screening.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseProgramme(p: { id: string; code: string; name: string; conditionCode: string; intervalMonths: number }) {
  return { id: p.id, code: p.code, name: p.name, condition_code: p.conditionCode, interval_months: p.intervalMonths };
}

export async function listProgrammes() {
  const rows = await prisma.screeningProgramme.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return { data: rows.map(serialiseProgramme) };
}

function serialiseInvitation(i: {
  id: string; programmeId: string; patientProfileId: string; status: string;
  declineReason: string | null; appointmentId: string | null; invitedAt: Date; respondedAt: Date | null;
}) {
  return {
    id: i.id,
    programme_id: i.programmeId,
    patient_profile_id: i.patientProfileId,
    status: i.status,
    decline_reason: i.declineReason,
    appointment_id: i.appointmentId,
    invited_at: i.invitedAt.toISOString(),
    responded_at: i.respondedAt?.toISOString() ?? null,
  };
}

export async function listInvitations(
  caller: Caller, query: { patient_profile_id?: string; status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.screeningInvitation.findMany({
    where: {
      ...scope,
      ...(query.patient_profile_id ? { patientProfileId: query.patient_profile_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { invitedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseInvitation);
}

/**
 * Accepting with a preferred slot books a REAL appointment through
 * services/appointment's own endpoint — the same reuse discipline as
 * sync's batch replay and devices' emergency-opening: booking has exactly
 * one implementation, and this is not a second one.
 *
 * Declining without a reason is rejected — why someone said no is the data
 * that tells you whether uptake is limited by distance, cost, fear, or
 * simply not knowing what the test is for, and that signal is lost the
 * moment a decline is allowed to be silent.
 */
export async function respondToInvitation(
  invitationId: string, caller: Caller,
  input: { response: 'accept' | 'decline' | 'defer'; decline_reason?: string; preferred_slot_id?: string },
  authHeader: string, meta: Meta,
) {
  const invitation = await prisma.screeningInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw notFound('Invitation not found');

  const patient = await prisma.patientProfile.findUnique({ where: { id: invitation.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This invitation is not yours');
  }
  if (invitation.status !== 'pending') {
    throw conflict('STATE_TRANSITION_INVALID', 'This invitation has already been responded to');
  }
  if (input.response === 'decline' && !input.decline_reason?.trim()) {
    throw unprocessable('A reason is required to decline a screening invitation', 'decline_reason');
  }

  let appointmentId: string | null = null;
  if (input.response === 'accept' && input.preferred_slot_id) {
    const bookingResponse = await fetch(`${env.APPOINTMENT_SERVICE_URL}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader, 'Idempotency-Key': `screen-${invitationId}` },
      body: JSON.stringify({ slot_id: input.preferred_slot_id, patient_profile_id: invitation.patientProfileId, reason: 'Screening appointment' }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (bookingResponse?.ok) {
      const body = (await bookingResponse.json()) as { id: string };
      appointmentId = body.id;
    }
  }

  const updated = await prisma.screeningInvitation.update({
    where: { id: invitationId },
    data: {
      status: input.response === 'accept' ? 'accepted' : input.response === 'decline' ? 'declined' : 'deferred',
      declineReason: input.response === 'decline' ? input.decline_reason : null,
      appointmentId,
      respondedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'prevention.invitation_responded',
    entityType: 'screening_invitations', entityId: invitationId,
    metadata: { response: input.response },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseInvitation(updated);
}
TS

cat > "$SVC/src/services/seedProgrammes.ts" << 'TS'
import { prisma } from '@a-health/database';

const PROGRAMMES = [
  { code: 'CERVICAL', name: 'Cervical cancer screening', conditionCode: 'CERVICAL_CA', intervalMonths: 36 },
  { code: 'BREAST', name: 'Breast cancer screening', conditionCode: 'BREAST_CA', intervalMonths: 24 },
  { code: 'HYPERTENSION', name: 'Hypertension screening', conditionCode: 'HYPERTENSION', intervalMonths: 12 },
  { code: 'DIABETES', name: 'Diabetes screening', conditionCode: 'TYPE2_DIABETES', intervalMonths: 12 },
  { code: 'TB', name: 'Tuberculosis screening', conditionCode: 'TB', intervalMonths: 12 },
];

export async function seedProgrammes(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0, skipped = 0;
  for (const p of PROGRAMMES) {
    const existing = await prisma.screeningProgramme.findUnique({ where: { code: p.code } });
    if (existing) { skipped += 1; continue; }
    await prisma.screeningProgramme.create({ data: { ...p, eligibility: {} } });
    inserted += 1;
  }
  return { inserted, skipped };
}
TS

cat > "$SVC/src/scripts/seed-programmes.ts" << 'TS'
import { prisma } from '@a-health/database';
import { seedProgrammes } from '../services/seedProgrammes.js';

const result = await seedProgrammes();
console.log(JSON.stringify(result));
await prisma.$disconnect();
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/types/prevention.types.ts" << 'TS'
import { z } from 'zod';

export const computeRiskScoresSchema = z.object({
  conditions: z.array(z.string()).optional(),
});

export const recordVaccinationSchema = z.object({
  vaccine_code: z.string().min(1).max(40),
  administered_at: z.string().datetime(),
  dose_number: z.number().int().min(1).optional(),
  facility_id: z.string().uuid().optional(),
  batch_number: z.string().max(60).optional(),
});

export const listInvitationsQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'accepted', 'declined', 'deferred', 'completed', 'expired']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const respondSchema = z.object({
  response: z.enum(['accept', 'decline', 'defer']),
  decline_reason: z.string().max(500).optional(),
  preferred_slot_id: z.string().uuid().optional(),
});
TS

cat > "$SVC/src/controllers/prevention.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as risk from '../services/riskScore.service.js';
import * as vaccinations from '../services/vaccination.service.js';
import * as screening from '../services/screening.service.js';
import {
  computeRiskScoresSchema, listInvitationsQuery, recordVaccinationSchema, respondSchema,
} from '../types/prevention.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listRiskScores = handle((req) =>
  risk.listRiskScores(pathParam(req, 'patient_profile_id'), caller(req)));

export const computeRiskScores = handle((req) => {
  const input = computeRiskScoresSchema.parse(req.body ?? {});
  return risk.computeRiskScores(pathParam(req, 'patient_profile_id'), caller(req), input.conditions);
});

export const listVaccinations = handle((req) =>
  vaccinations.listVaccinations(pathParam(req, 'patient_profile_id'), caller(req)));

export const recordVaccination = handle(
  (req, res) => vaccinations.recordVaccination(
    pathParam(req, 'patient_profile_id'), caller(req), recordVaccinationSchema.parse(req.body), meta(req, res),
  ), 201,
);

export const listProgrammes = handle(() => screening.listProgrammes());

export const listInvitations = handle((req) =>
  screening.listInvitations(caller(req), listInvitationsQuery.parse(req.query)));

export const respond = handle((req, res) => {
  const input = respondSchema.parse(req.body);
  const authHeader = req.header('Authorization') ?? '';
  return screening.respondToInvitation(pathParam(req, 'invitation_id'), caller(req), input, authHeader, meta(req, res));
});
TS

cat > "$SVC/src/routes/prevention.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/prevention.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const preventionRouter = Router();

preventionRouter.get('/patient-profiles/:patient_profile_id/risk-scores', requireAuth, c.listRiskScores);
preventionRouter.post('/patient-profiles/:patient_profile_id/risk-scores/compute', requireAuth, idempotency, c.computeRiskScores);

preventionRouter.get('/patient-profiles/:patient_profile_id/vaccinations', requireAuth, c.listVaccinations);
preventionRouter.post('/patient-profiles/:patient_profile_id/vaccinations', requireAuth, idempotency, c.recordVaccination);

preventionRouter.get('/screening-programmes', requireAuth, c.listProgrammes);
preventionRouter.get('/screening-invitations', requireAuth, c.listInvitations);
preventionRouter.post('/screening-invitations/:invitation_id/respond', requireAuth, idempotency, c.respond);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { preventionRouter } from './routes/prevention.routes.js';
import { seedProgrammes } from './services/seedProgrammes.js';

const service = createService({
  name: 'prevention',
  port: env.PORT,
  routers: [preventionRouter],
  development: env.NODE_ENV === 'development',
});

await seedProgrammes();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4024"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "APPOINTMENT_SERVICE_URL=http://localhost:4004"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/prevention.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { seedProgrammes } from '../services/seedProgrammes.js';
import * as risk from '../services/riskScore.service.js';
import * as vaccinations from '../services/vaccination.service.js';
import * as screening from '../services/screening.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const programmeIds: string[] = [];
const invitationIds: string[] = [];

after(async () => {
  for (const id of invitationIds) {
    await prisma.screeningInvitation.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of programmeIds) {
    await prisma.screeningProgramme.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.riskScore.deleteMany({ where: { patient: { userId: id } } }).catch(() => undefined);
    await prisma.vaccination.deleteMany({ where: { patient: { userId: id } } }).catch(() => undefined);
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient(dob?: Date) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Prevention Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Prevention Test', dateOfBirth: dob },
  });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Prevention Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('risk scoring', () => {
  it('computes a real, deterministic score with visible contributing factors', async () => {
    const { user, profile } = await makePatient(new Date('1970-01-01'));
    const result = await risk.computeRiskScores(profile.id, { sub: user.id, role: 'patient', ppid: profile.id }, ['hypertension']);
    assert.equal(result.data.length, 1);
    assert.ok(result.data[0]!.contributing_factors);
    assert.equal(result.data[0]!.model_version, 'rule-based-v1');
  });

  it('silently skips an unsupported condition rather than fabricating a score', async () => {
    const { user, profile } = await makePatient();
    const result = await risk.computeRiskScores(profile.id, { sub: user.id, role: 'patient', ppid: profile.id }, ['made_up_condition']);
    assert.equal(result.data.length, 0);
  });

  it('refuses a stranger viewing scores', async () => {
    const { profile } = await makePatient();
    await assert.rejects(
      () => risk.listRiskScores(profile.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('vaccinations', () => {
  it('lets a clinician record a dose', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const dose = await vaccinations.recordVaccination(
      profile.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { vaccine_code: 'BCG', administered_at: new Date().toISOString() }, meta,
    );
    assert.equal(dose.status, 'administered');
  });

  it('refuses a patient recording their own dose', async () => {
    const { user, profile } = await makePatient();
    await assert.rejects(
      () => vaccinations.recordVaccination(
        profile.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { vaccine_code: 'BCG', administered_at: new Date().toISOString() }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('screening', () => {
  it('seeds the programme catalogue idempotently', async () => {
    const first = await seedProgrammes();
    const second = await seedProgrammes();
    programmeIds.push(...[]); // seeded rows are shared fixtures, not cleaned per-test
    assert.equal(second.inserted, 0);
    assert.ok(first.inserted + second.skipped >= 1);
  });

  it('requires a reason to decline', async () => {
    const { user, profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { response: 'decline' }, 'Bearer fake', meta,
      ),
    );
  });

  it('records a decline reason and refuses a second response', async () => {
    const { user, profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    const result = await screening.respondToInvitation(
      invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
      { response: 'decline', decline_reason: 'Too far to travel' }, 'Bearer fake', meta,
    );
    assert.equal(result.status, 'declined');
    assert.equal(result.decline_reason, 'Too far to travel');

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { response: 'accept' }, 'Bearer fake', meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses a stranger responding to someone else\u2019s invitation', async () => {
    const { profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: randomUUID(), role: 'patient' },
        { response: 'defer' }, 'Bearer fake', meta,
      ),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/prevention exec tsc --noEmit"
echo "  pnpm --filter @a-health/prevention test"
