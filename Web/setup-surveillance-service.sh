#!/usr/bin/env bash
#
# Builds services/surveillance — disease trend and outbreak signal reporting
# (blueprint §21). Reads answer from SurveillanceRollup, which a real worker
# populates from actual diagnosis data (ConsultationNote.diagnosisCodes,
# grouped by the patient's regionCode) — not a stub table nobody fills.
#
# The outbreak signal itself (expected_low/expected_high, above_expected) is
# left null/false here: that needs a real forecasting model (Prophet, in the
# AI registry as not_deployed) and is not fabricated in its absence. What
# this service guarantees is the honest count.
#
# Run from the repo root:
#   bash setup-surveillance-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/surveillance"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in FORBIDDEN ROLE_NOT_PERMITTED VALIDATION_FAILED; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,workers,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/surveillance';
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
  PORT: z.coerce.number().default(4020),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  ROLLUP_INTERVAL_MINUTES: z.coerce.number().default(60),
  /** How many days back each tick recomputes. Idempotent recompute of a bounded window, not an ever-growing incremental patch. */
  ROLLUP_WINDOW_DAYS: z.coerce.number().default(7),
});

export const env = envSchema.parse(process.env);
TS

# --- the rollup worker: real data, computed honestly -------------------------
cat > "$SVC/src/workers/rollup.worker.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('surveillance.rollup');

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

/**
 * Recomputes SurveillanceRollup for a bounded recent window, from real
 * ConsultationNote.diagnosisCodes joined through to the patient's own
 * regionCode. Deletes and rewrites the window's rollups each run rather than
 * incrementally upserting — idempotent by construction, matching the
 * pattern the followup and consultation SLA workers already use.
 *
 * A note with no regionCode on its patient contributes to the `national`
 * level only, never to a fabricated region — an unknown location is left
 * unknown, not guessed into a district it may not belong to.
 */
export async function computeRollups(now = new Date()): Promise<{ daysProcessed: number; rowsWritten: number }> {
  let rowsWritten = 0;
  const days = env.ROLLUP_WINDOW_DAYS;

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(now.getTime() - offset * 86_400_000);
    const periodStart = startOfDay(day);
    const periodEnd = endOfDay(day);

    const notes = await prisma.consultationNote.findMany({
      where: { signedAt: { gte: periodStart, lte: periodEnd } },
      select: {
        diagnosisCodes: true,
        consultation: { select: { patient: { select: { regionCode: true } } } },
      },
    });

    // regionCode -> conditionCode -> count. 'national' is always populated;
    // a region key is added only when the patient's regionCode is known.
    const counts = new Map<string, Map<string, number>>();
    const bump = (area: string, code: string) => {
      if (!counts.has(area)) counts.set(area, new Map());
      const inner = counts.get(area)!;
      inner.set(code, (inner.get(code) ?? 0) + 1);
    };

    for (const note of notes) {
      const codes = Array.isArray(note.diagnosisCodes) ? (note.diagnosisCodes as string[]) : [];
      const region = note.consultation.patient.regionCode;
      for (const code of codes) {
        bump('national', code);
        if (region) bump(region, code);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.surveillanceRollup.deleteMany({
        where: { periodStart, level: { in: ['national', 'region'] } },
      });

      const rows: {
        level: 'national' | 'region'; areaCode: string; conditionCode: string; conditionName: string;
        periodStart: Date; periodEnd: Date; count: number;
      }[] = [];

      for (const [area, byCode] of counts) {
        const level = area === 'national' ? 'national' : 'region';
        for (const [code, count] of byCode) {
          rows.push({ level, areaCode: area, conditionCode: code, conditionName: code, periodStart, periodEnd, count });
        }
      }

      if (rows.length > 0) {
        await tx.surveillanceRollup.createMany({ data: rows as never });
      }
      rowsWritten += rows.length;
    });
  }

  return { daysProcessed: days, rowsWritten };
}

export function startRollupWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void computeRollups()
      .then((r) => logger.info('rollup tick', r))
      .catch((e) => logger.error('rollup tick failed', { err: String(e) }));
  }, env.ROLLUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  logger.info('rollup worker started', { intervalMinutes: env.ROLLUP_INTERVAL_MINUTES, windowDays: env.ROLLUP_WINDOW_DAYS });
  return timer;
}
TS

# --- read service --------------------------------------------------------
cat > "$SVC/src/services/surveillance.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { forbidden } from '@a-health/http';

export interface Caller { role: string }

function assertPrivileged(caller: Caller) {
  if (caller.role !== 'platform_admin' && caller.role !== 'clinician') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Aggregate surveillance data is not available to this role');
  }
}

/**
 * Ranked, aggregated only — this is population-level reporting, never a
 * per-patient view. Reads what the rollup worker has actually computed; an
 * area with no data returns an empty list, not a fabricated one.
 */
export async function getConditions(
  caller: Caller, query: { level: string; area_code?: string; from?: string; to?: string },
) {
  assertPrivileged(caller);

  const rows = await prisma.surveillanceRollup.groupBy({
    by: ['conditionCode', 'conditionName'],
    where: {
      level: query.level as never,
      ...(query.area_code ? { areaCode: query.area_code } : {}),
      ...(query.from || query.to
        ? { periodStart: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
    take: 20,
  });

  return {
    data: rows.map((r, i) => ({
      condition_code: r.conditionCode,
      condition_name: r.conditionName,
      count: r._sum.count ?? 0,
      rate_per_100k: null,
      rank: i + 1,
      change_percent: null,
    })),
  };
}

/**
 * `expected_low`/`expected_high`/`above_expected` are always null/false
 * here — a real outbreak-detection band needs a forecasting model (Prophet,
 * still `not_deployed` in the AI registry), and this endpoint does not
 * fabricate one in its absence. What it returns is the honest daily count.
 */
export async function getTrends(
  caller: Caller,
  query: { condition_code: string; level: string; area_code?: string; from?: string; to?: string },
) {
  assertPrivileged(caller);

  const rows = await prisma.surveillanceRollup.findMany({
    where: {
      conditionCode: query.condition_code,
      level: query.level as never,
      ...(query.area_code ? { areaCode: query.area_code } : {}),
      ...(query.from || query.to
        ? { periodStart: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    orderBy: { periodStart: 'asc' },
  });

  return {
    condition_code: query.condition_code,
    level: query.level,
    area_code: query.area_code ?? null,
    points: rows.map((r) => ({
      period: r.periodStart.toISOString().slice(0, 10),
      count: r.count,
      expected_low: r.expectedLow,
      expected_high: r.expectedHigh,
      above_expected: r.aboveExpected,
    })),
    model_version: null,
  };
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/surveillance.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import * as surveillance from '../services/surveillance.service.js';

const caller = (req: Request) => ({ role: req.auth!.role });

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getConditions = handle((req) => {
  const { level, area_code, from, to } = req.query as Record<string, string>;
  return surveillance.getConditions(caller(req), { level, area_code, from, to });
});

export const getTrends = handle((req) => {
  const { condition_code, level, area_code, from, to } = req.query as Record<string, string>;
  return surveillance.getTrends(caller(req), { condition_code, level, area_code, from, to });
});
TS

cat > "$SVC/src/routes/surveillance.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/surveillance.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const surveillanceRouter = Router();

surveillanceRouter.get('/surveillance/conditions', requireAuth, c.getConditions);
surveillanceRouter.get('/surveillance/trends', requireAuth, c.getTrends);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { surveillanceRouter } from './routes/surveillance.routes.js';
import { startRollupWorker } from './workers/rollup.worker.js';

const service = createService({
  name: 'surveillance',
  port: env.PORT,
  routers: [surveillanceRouter],
  development: env.NODE_ENV === 'development',
});

startRollupWorker();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4020"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/surveillance.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { computeRollups } from '../workers/rollup.worker.js';
import * as surveillance from '../services/surveillance.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const admin = { role: 'platform_admin' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const noteIds: string[] = [];

after(async () => {
  for (const id of noteIds) {
    await prisma.consultationNote.delete({ where: { id } }).catch(() => undefined);
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
  await prisma.surveillanceRollup.deleteMany({ where: { conditionCode: 'TEST-MALARIA' } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Surv Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeNotedConsultation(clinicianId: string, regionCode: string | null, diagnosisCode: string) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Surv Patient' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Surv Patient', regionCode: regionCode ?? undefined },
  });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  const note = await prisma.consultationNote.create({
    data: {
      consultationId: consultation.id, careThreadId: thread.id,
      diagnosisText: 'test', diagnosisCodes: [diagnosisCode] as never,
      adviceText: 'test', signedByClinicianId: clinicianId, signedAt: new Date(),
    },
  });
  noteIds.push(note.id);
  return { consultation, note };
}

describe('rollup worker', () => {
  it('computes national and regional counts from real diagnosis notes', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'DAR', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, 'DAR', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, null, 'TEST-MALARIA');

    await computeRollups();

    const national = await prisma.surveillanceRollup.findFirst({
      where: { level: 'national', conditionCode: 'TEST-MALARIA' },
    });
    assert.ok(national);
    assert.equal(national!.count, 3);

    const regional = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'DAR', conditionCode: 'TEST-MALARIA' },
    });
    assert.ok(regional);
    assert.equal(regional!.count, 2);
  });

  it('is idempotent \u2014 a second run for the same window does not double the count', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'ARU', 'TEST-MALARIA');

    await computeRollups();
    const firstRun = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'ARU', conditionCode: 'TEST-MALARIA' },
    });
    await computeRollups();
    const secondRun = await prisma.surveillanceRollup.findFirst({
      where: { level: 'region', areaCode: 'ARU', conditionCode: 'TEST-MALARIA' },
    });

    assert.equal(firstRun!.count, secondRun!.count);
  });

  it('never invents a region for a patient with none on record', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, null, 'TEST-MALARIA');

    await computeRollups();

    const regionalRows = await prisma.surveillanceRollup.count({
      where: { level: 'region', conditionCode: 'TEST-MALARIA', areaCode: '' },
    });
    assert.equal(regionalRows, 0);
  });
});

describe('reading', () => {
  it('ranks conditions by count, most common first', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'MWZ', 'TEST-MALARIA');
    await makeNotedConsultation(clinician.id, 'MWZ', 'TEST-MALARIA');
    await computeRollups();

    const result = await surveillance.getConditions(admin, { level: 'region', area_code: 'MWZ' });
    const entry = result.data.find((d) => d.condition_code === 'TEST-MALARIA');
    assert.ok(entry);
    assert.equal(entry!.count, 2);
  });

  it('refuses a role with no privilege to view aggregate data', async () => {
    await assert.rejects(
      () => surveillance.getConditions({ role: 'patient' }, { level: 'national' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('returns null expected bounds honestly rather than fabricating a forecast', async () => {
    const clinician = await makeClinician();
    await makeNotedConsultation(clinician.id, 'DOD', 'TEST-MALARIA');
    await computeRollups();

    const result = await surveillance.getTrends(admin, { condition_code: 'TEST-MALARIA', level: 'region', area_code: 'DOD' });
    assert.ok(result.points.length > 0);
    assert.equal(result.points[0]!.expected_low, null);
    assert.equal(result.points[0]!.above_expected, false);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/surveillance exec tsc --noEmit"
echo "  pnpm --filter @a-health/surveillance test"
