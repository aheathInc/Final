#!/usr/bin/env bash
#
# Builds services/quality — consultation ratings and incident reports.
# The "System Safeguards & Community" pillar: rating feeds routing (an input
# among several, never the only one — ranking purely on rating would push
# difficult cases away from the people best able to handle them), and
# incident reporting exists to make the platform safer over time, not to
# punish.
#
# Run from the repo root:
#   bash setup-quality-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/quality"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in ALREADY_RATED STATE_TRANSITION_INVALID NOT_RESOURCE_OWNER ROLE_NOT_PERMITTED NOT_FOUND; do
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
pkg.name = pkg.name || '@a-health/quality';
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
  PORT: z.coerce.number().default(4014),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/quality.types.ts" << 'TS'
import { z } from 'zod';

export const rateConsultationSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const createIncidentSchema = z.object({
  category: z.enum(['clinical_care', 'misconduct', 'medication_error', 'delayed_response', 'data_privacy', 'ai_error', 'other']),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  description: z.string().min(1).max(4000),
  consultation_id: z.string().uuid().optional(),
  clinician_id: z.string().uuid().optional(),
  facility_id: z.string().uuid().optional(),
  anonymous: z.boolean().optional(),
});

export const listIncidentsQuery = z.object({
  status: z.enum(['reported', 'under_investigation', 'action_taken', 'closed']).optional(),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
TS

# --- rating service ---------------------------------------------------------
cat > "$SVC/src/services/rating.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(r: { id: string; consultationId: string; clinicianId: string; score: number; comment: string | null; createdAt: Date }) {
  return {
    id: r.id,
    consultation_id: r.consultationId,
    clinician_id: r.clinicianId,
    score: r.score,
    comment: r.comment,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * One rating per consultation, from the patient it belongs to. Feeds the
 * clinician's average, which is one input among several to routing — not
 * the only one, because ranking purely on rating pushes difficult cases
 * away from the people best able to handle them.
 */
export async function rateConsultation(
  consultationId: string, caller: Caller, input: { score: number; comment?: string }, meta: Meta,
) {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!consultation) throw notFound('Consultation not found');

  const owns = consultation.patient.userId === caller.sub || consultation.patient.guardianUserId === caller.sub;
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot rate this consultation');
  if (!consultation.assignedClinicianId) {
    throw conflict('STATE_TRANSITION_INVALID', 'This consultation has no assigned clinician to rate');
  }

  const existing = await prisma.consultationRating.findUnique({ where: { consultationId } });
  if (existing) throw conflict('ALREADY_RATED', 'This consultation has already been rated');

  const clinicianId = consultation.assignedClinicianId;

  const rating = await prisma.$transaction(async (tx) => {
    const created = await tx.consultationRating.create({
      data: { consultationId, clinicianId, score: input.score, comment: input.comment ?? null },
    });

    // Recomputed from the full set rather than incrementally averaged, so a
    // rounding drift can never accumulate across thousands of ratings.
    const agg = await tx.consultationRating.aggregate({
      where: { clinicianId },
      _avg: { score: true },
    });
    await tx.clinicianProfile.update({
      where: { id: clinicianId },
      data: { ratingAvg: agg._avg.score ?? null, version: { increment: 1 } },
    });

    return created;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.rated',
    entityType: 'consultation_ratings', entityId: rating.id,
    metadata: { consultationId, clinicianId, score: input.score },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(rating);
}
TS

# --- incident service --------------------------------------------------------
cat > "$SVC/src/services/incident.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, cursorArgs, forbidden, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

const ESCALATING_SEVERITIES = new Set(['serious', 'catastrophic']);

function serialise(r: {
  id: string; category: string; severity: string; status: string; description: string;
  consultationId: string | null; clinicianId: string | null; facilityId: string | null;
  anonymous: boolean; escalatedToGovernance: boolean; reportedAt: Date; closedAt: Date | null;
}) {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity,
    status: r.status,
    description: r.description,
    consultation_id: r.consultationId,
    clinician_id: r.clinicianId,
    facility_id: r.facilityId,
    anonymous: r.anonymous,
    escalated_to_governance: r.escalatedToGovernance,
    reported_at: r.reportedAt.toISOString(),
    closed_at: r.closedAt?.toISOString() ?? null,
  };
}

/**
 * Open to patients and staff alike. Serious and catastrophic reports escalate
 * directly to clinical and governance leadership rather than entering a
 * customer-service queue — the point is improvement, not punishment, but
 * that only works if the report actually reaches someone who can act on it.
 *
 * A reporter who fears identification does not report. When `anonymous` is
 * set, the reporter's id is never written to the row at all — not stored and
 * later hidden, genuinely absent.
 */
export async function createIncidentReport(
  caller: Caller,
  input: {
    category: string; severity?: string; description: string;
    consultation_id?: string; clinician_id?: string; facility_id?: string; anonymous?: boolean;
  },
  meta: Meta,
) {
  const severity = input.severity ?? 'moderate';
  const escalate = ESCALATING_SEVERITIES.has(severity);

  const report = await prisma.incidentReport.create({
    data: {
      category: input.category as never,
      severity: severity as never,
      description: input.description,
      reportedByUserId: input.anonymous ? null : caller.sub,
      anonymous: Boolean(input.anonymous),
      consultationId: input.consultation_id ?? null,
      clinicianId: input.clinician_id ?? null,
      facilityId: input.facility_id ?? null,
      escalatedToGovernance: escalate,
    },
  });

  await appendAudit({
    // Never attributed to the reporter when anonymous — even in the audit
    // trail, which exists to record actions, not to unmask a report the
    // reporter deliberately chose not to sign.
    actorUserId: input.anonymous ? null : caller.sub,
    action: escalate ? 'incident.reported_escalated' : 'incident.reported',
    entityType: 'incident_reports', entityId: report.id,
    metadata: { category: input.category, severity },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(report);
}

/** Governance visibility only — this is the leadership-facing queue. */
export async function listIncidentReports(
  caller: Caller,
  query: { status?: string; severity?: string; cursor?: string; limit: number },
) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only governance may list incident reports');
  }
  const rows = await prisma.incidentReport.findMany({
    where: {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.severity ? { severity: query.severity as never } : {}),
    },
    orderBy: [{ escalatedToGovernance: 'desc' }, { reportedAt: 'desc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/quality.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as ratings from '../services/rating.service.js';
import * as incidents from '../services/incident.service.js';
import { createIncidentSchema, listIncidentsQuery, rateConsultationSchema } from '../types/quality.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const rate = handle(
  (req, res) => ratings.rateConsultation(pathParam(req, 'consultation_id'), caller(req), rateConsultationSchema.parse(req.body), meta(req, res)),
  201,
);

export const createIncident = handle(
  (req, res) => incidents.createIncidentReport(caller(req), createIncidentSchema.parse(req.body), meta(req, res)),
  201,
);

export const listIncidents = handle((req) => incidents.listIncidentReports(caller(req), listIncidentsQuery.parse(req.query)));
TS

cat > "$SVC/src/routes/quality.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/quality.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const qualityRouter = Router();

qualityRouter.post('/consultations/:consultation_id/rating', requireAuth, idempotency, c.rate);
qualityRouter.post('/incident-reports', requireAuth, idempotency, c.createIncident);
qualityRouter.get('/incident-reports', requireAuth, c.listIncidents);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { qualityRouter } from './routes/quality.routes.js';

const service = createService({
  name: 'quality',
  port: env.PORT,
  routers: [qualityRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4014"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/quality.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as ratings from '../services/rating.service.js';
import * as incidents from '../services/incident.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const incidentIds: string[] = [];

after(async () => {
  for (const id of incidentIds) {
    await prisma.incidentReport.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of consultationIds) {
    await prisma.consultationRating.deleteMany({ where: { consultationId: id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.consultationRequest.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Quality Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Quality Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Quality Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeCompletedConsultation() {
  const { user, profile } = await makePatient();
  const clinician = await makeClinician();
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinician.id,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  return { user, profile, clinician, consultation };
}

describe('rating', () => {
  it('rates a consultation and updates the clinician average', async () => {
    const { user, clinician, consultation } = await makeCompletedConsultation();
    const result = await ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 5 }, meta);
    assert.equal(result.score, 5);

    const reloaded = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: clinician.id } });
    assert.equal(Number(reloaded.ratingAvg), 5);
  });

  it('refuses to rate the same consultation twice', async () => {
    const { user, consultation } = await makeCompletedConsultation();
    await ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 4 }, meta);

    await assert.rejects(
      () => ratings.rateConsultation(consultation.id, { sub: user.id, role: 'patient' }, { score: 2 }, meta),
      (e: AppError) => e.code === 'ALREADY_RATED',
    );
  });

  it('refuses a stranger rating someone else\u2019s consultation', async () => {
    const { consultation } = await makeCompletedConsultation();
    await assert.rejects(
      () => ratings.rateConsultation(consultation.id, { sub: randomUUID(), role: 'patient' }, { score: 3 }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('averages correctly across multiple clinicians\u2019 ratings', async () => {
    const first = await makeCompletedConsultation();
    const clinician = first.clinician;
    await ratings.rateConsultation(first.consultation.id, { sub: first.user.id, role: 'patient' }, { score: 4 }, meta);

    const { user: user2, profile: profile2 } = await makePatient();
    const thread2 = await prisma.careThread.create({ data: { patientProfileId: profile2.id } });
    threadIds.push(thread2.id);
    const consultation2 = await prisma.consultationRequest.create({
      data: {
        careThreadId: thread2.id, patientProfileId: profile2.id, assignedClinicianId: clinician.id,
        channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
        status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    consultationIds.push(consultation2.id);
    await ratings.rateConsultation(consultation2.id, { sub: user2.id, role: 'patient' }, { score: 2 }, meta);

    const reloaded = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: clinician.id } });
    assert.equal(Number(reloaded.ratingAvg), 3);
  });
});

describe('incident reports', () => {
  it('records who reported when not anonymous', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'clinical_care', description: 'Was kept waiting far past the SLA.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.anonymous, false);

    const row = await prisma.incidentReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.reportedByUserId, user.id);
  });

  it('never stores the reporter when anonymous', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'misconduct', description: 'Reporting anonymously.', anonymous: true }, meta,
    );
    incidentIds.push(report.id);

    const row = await prisma.incidentReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.reportedByUserId, null);
  });

  it('escalates serious and catastrophic reports to governance', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'medication_error', severity: 'serious', description: 'Wrong dosage dispensed.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.escalated_to_governance, true);
  });

  it('does not escalate a low-severity report', async () => {
    const { user } = await makePatient();
    const report = await incidents.createIncidentReport(
      { sub: user.id, role: 'patient' },
      { category: 'other', severity: 'low', description: 'Minor UI confusion.' }, meta,
    );
    incidentIds.push(report.id);
    assert.equal(report.escalated_to_governance, false);
  });

  it('refuses listing to a non-admin', async () => {
    await assert.rejects(
      () => incidents.listIncidentReports({ sub: randomUUID(), role: 'patient' }, { limit: 10 }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('lets governance list reports, most urgent first', async () => {
    const { user } = await makePatient();
    await incidents.createIncidentReport({ sub: user.id, role: 'patient' }, { category: 'other', severity: 'low', description: 'a' }, meta)
      .then((r) => incidentIds.push(r.id));
    await incidents.createIncidentReport({ sub: user.id, role: 'patient' }, { category: 'misconduct', severity: 'catastrophic', description: 'b' }, meta)
      .then((r) => incidentIds.push(r.id));

    const result = await incidents.listIncidentReports({ sub: randomUUID(), role: 'platform_admin' }, { limit: 10 });
    assert.ok(result.data.length >= 2);
    assert.equal(result.data[0]!.escalated_to_governance, true);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/quality exec tsc --noEmit"
echo "  pnpm --filter @a-health/quality test"
