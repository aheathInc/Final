#!/usr/bin/env bash
#
# Builds services/diagnostics — laboratory, imaging and pathology orders and
# results. This is Gap 5 from the blueprint: late pathology discovery. The
# mechanism that actually closes that gap is narrow and specific — a result
# outside its bounds must escalate on its own, not wait for a clinician to
# happen to open the record.
#
# Run from the repo root:
#   bash setup-diagnostics-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/diagnostics"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists, before
# writing anything that could fail tsc on a gap we could have caught first.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in RESULT_ALREADY_ACKNOWLEDGED STATE_TRANSITION_INVALID NOT_RESOURCE_OWNER ROLE_NOT_PERMITTED NOT_FOUND; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,engine,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/diagnostics';
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
  PORT: z.coerce.number().default(4013),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

# --- the one clinically load-bearing piece: result flagging -----------------
cat > "$SVC/src/engine/resultFlag.ts" << 'TS'
/**
 * Computes a result's flag from its numeric value and bounds.
 *
 * This is the mechanism that actually closes the blueprint's "late
 * pathology discovery" gap: a critical result must escalate on its own,
 * because a discovery nobody looked at is not a discovery. The flag is
 * always computed here, from server-held bounds — never accepted as a
 * client-supplied field, for the same reason a check-in's is_deviation is
 * never trusted from the client: a patient's phone (or, here, whoever is
 * filing the result) deciding whether their own result looks critical
 * would defeat the point of having a threshold at all.
 *
 * Reference range and critical range are two different clinical concepts.
 * A potassium of 5.6 might be flagged high against the reference range
 * (3.5–5.0) without yet being the critical value (6.5) that demands
 * immediate action — the two bounds are evaluated independently, and
 * critical always wins when both apply.
 *
 * Non-numeric values (a qualitative "positive"/"negative" pathology result)
 * cannot be evaluated by this function and are flagged `normal` by default
 * — a documented limitation, not a silent gap: introducing a client-trusted
 * flag for the unparseable case would reopen exactly the trust hole this
 * exists to close.
 */

export type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

export interface FlagInput {
  value: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export function computeFlag(input: FlagInput): ResultFlag {
  const numeric = Number(input.value);
  if (Number.isNaN(numeric)) return 'normal';

  if (input.criticalLow !== undefined && numeric <= input.criticalLow) return 'critical_low';
  if (input.criticalHigh !== undefined && numeric >= input.criticalHigh) return 'critical_high';
  if (input.referenceLow !== undefined && numeric < input.referenceLow) return 'low';
  if (input.referenceHigh !== undefined && numeric > input.referenceHigh) return 'high';
  return 'normal';
}

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === 'critical_low' || flag === 'critical_high';
}
TS

# --- types --------------------------------------------------------------------
cat > "$SVC/src/types/diagnostics.types.ts" << 'TS'
import { z } from 'zod';

export const createOrderSchema = z.object({
  care_thread_id: z.string().uuid(),
  consultation_id: z.string().uuid().optional(),
  investigation_code: z.string().min(1).max(60),
  investigation_type: z.enum(['laboratory', 'imaging', 'pathology', 'point_of_care']),
  clinical_notes: z.string().max(2000).optional(),
  urgency: z.enum(['routine', 'urgent', 'emergency']).optional(),
  facility_id: z.string().uuid().optional(),
});

export const resultValueSchema = z.object({
  analyte: z.string().min(1).max(120),
  value: z.string().min(1).max(200),
  unit: z.string().max(40).optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
  /** Consumed only to compute the flag server-side; not persisted as-is. */
  critical_low: z.number().optional(),
  critical_high: z.number().optional(),
});

export const fileResultSchema = z.object({
  values: z.array(resultValueSchema).min(1),
  narrative: z.string().max(4000).optional(),
  attachment_key: z.string().max(500).optional(),
});

export const listOrdersQuery = z.object({
  care_thread_id: z.string().uuid().optional(),
  status: z.enum(['ordered', 'scheduled', 'collected', 'resulted', 'acknowledged', 'cancelled']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type FileResultInput = z.infer<typeof fileResultSchema>;
TS

# --- service --------------------------------------------------------------
cat > "$SVC/src/services/investigation.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage,
} from '@a-health/http';
import { computeFlag, isCriticalFlag } from '../engine/resultFlag.js';
import type { CreateOrderInput, FileResultInput } from '../types/diagnostics.types.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseOrder(o: {
  id: string; careThreadId: string; consultationId: string | null; patientProfileId: string;
  orderedById: string; facilityId: string | null; investigationCode: string; investigationType: string;
  urgency: string; status: string; clinicalNotes: string | null; narrative: string | null;
  attachmentKey: string | null; isCritical: boolean; acknowledgedById: string | null;
  acknowledgedAt: Date | null; orderedAt: Date; resultedAt: Date | null; version: number;
  values?: { analyte: string; value: string; unit: string | null; referenceLow: unknown; referenceHigh: unknown; flag: string }[];
}) {
  return {
    id: o.id,
    care_thread_id: o.careThreadId,
    consultation_id: o.consultationId,
    patient_profile_id: o.patientProfileId,
    ordered_by_id: o.orderedById,
    facility_id: o.facilityId,
    investigation_code: o.investigationCode,
    investigation_type: o.investigationType,
    urgency: o.urgency,
    status: o.status,
    clinical_notes: o.clinicalNotes,
    values: (o.values ?? []).map((v) => ({
      analyte: v.analyte,
      value: v.value,
      unit: v.unit,
      reference_low: v.referenceLow === null ? null : Number(v.referenceLow),
      reference_high: v.referenceHigh === null ? null : Number(v.referenceHigh),
      flag: v.flag,
    })),
    narrative: o.narrative,
    attachment_key: o.attachmentKey,
    is_critical: o.isCritical,
    acknowledged_by_id: o.acknowledgedById,
    acknowledged_at: o.acknowledgedAt?.toISOString() ?? null,
    ordered_at: o.orderedAt.toISOString(),
    resulted_at: o.resultedAt?.toISOString() ?? null,
    version: o.version,
  };
}

async function assertVisible(order: { patientProfileId: string; orderedById: string }, caller: Caller) {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && order.orderedById === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: order.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This investigation order is not yours');
}

/**
 * Orders an investigation. Clinician only — ordering is a clinical decision,
 * not something a patient or an unrelated party can initiate.
 */
export async function createOrder(caller: Caller, input: CreateOrderInput, meta: Meta) {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required to order an investigation');

  const thread = await prisma.careThread.findUnique({ where: { id: input.care_thread_id } });
  if (!thread) throw notFound('Care thread not found');

  const order = await prisma.investigationOrder.create({
    data: {
      careThreadId: input.care_thread_id,
      consultationId: input.consultation_id ?? null,
      patientProfileId: thread.patientProfileId,
      orderedById: caller.cpid,
      facilityId: input.facility_id ?? null,
      investigationCode: input.investigation_code,
      investigationType: input.investigation_type as never,
      urgency: (input.urgency ?? 'routine') as never,
      clinicalNotes: input.clinical_notes ?? null,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'investigation.ordered',
    entityType: 'investigation_orders', entityId: order.id,
    metadata: { investigationCode: input.investigation_code, urgency: order.urgency },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(order);
}

export async function getOrder(orderId: string, caller: Caller) {
  const order = await prisma.investigationOrder.findUnique({
    where: { id: orderId },
    include: { values: true },
  });
  if (!order) throw notFound('Investigation order not found');
  await assertVisible(order, caller);
  return serialiseOrder(order);
}

export async function listOrders(
  caller: Caller,
  query: { care_thread_id?: string; status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { orderedById: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.investigationOrder.findMany({
    where: {
      ...scope,
      ...(query.care_thread_id ? { careThreadId: query.care_thread_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: [{ isCritical: 'desc' }, { orderedAt: 'desc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseOrder);
}

/**
 * Files a result. `is_critical` and each value's `flag` are computed here,
 * from the order's own reference/critical bounds — never accepted from the
 * caller. A critical result is what makes this endpoint matter: it is the
 * moment a finding either starts escalating or quietly waits for someone to
 * open the chart, and this function is what decides which.
 */
export async function fileResult(orderId: string, caller: Caller, input: FileResultInput, meta: Meta) {
  const order = await prisma.investigationOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Investigation order not found');
  if (order.status === 'resulted' || order.status === 'acknowledged') {
    throw conflict('STATE_TRANSITION_INVALID', 'A result has already been filed for this order');
  }
  if (order.status === 'cancelled') {
    throw conflict('STATE_TRANSITION_INVALID', 'This order was cancelled');
  }

  const flaggedValues = input.values.map((v) => ({
    analyte: v.analyte,
    value: v.value,
    unit: v.unit ?? null,
    referenceLow: v.reference_low ?? null,
    referenceHigh: v.reference_high ?? null,
    flag: computeFlag({
      value: v.value,
      referenceLow: v.reference_low,
      referenceHigh: v.reference_high,
      criticalLow: v.critical_low,
      criticalHigh: v.critical_high,
    }),
  }));

  const isCritical = flaggedValues.some((v) => isCriticalFlag(v.flag as never));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.investigationValue.createMany({
      data: flaggedValues.map((v) => ({
        orderId,
        analyte: v.analyte,
        value: v.value,
        unit: v.unit,
        referenceLow: v.referenceLow,
        referenceHigh: v.referenceHigh,
        flag: v.flag as never,
      })),
    });

    return tx.investigationOrder.update({
      where: { id: orderId },
      data: {
        status: 'resulted',
        narrative: input.narrative ?? null,
        attachmentKey: input.attachment_key ?? null,
        isCritical,
        resultedAt: new Date(),
        version: { increment: 1 },
      },
      include: { values: true },
    });
  });

  await appendAudit({
    actorUserId: caller.sub,
    action: isCritical ? 'investigation.critical_result_filed' : 'investigation.result_filed',
    entityType: 'investigation_orders', entityId: orderId,
    metadata: { isCritical, analytes: flaggedValues.map((v) => v.analyte) },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(updated);
}

/**
 * Closes the loop on a result. Until a clinician acknowledges, a critical
 * finding is not treated as received — silence is never treated as receipt.
 */
export async function acknowledgeResult(orderId: string, caller: Caller, meta: Meta) {
  if (!caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required to acknowledge a result');

  const order = await prisma.investigationOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Investigation order not found');
  if (order.status === 'acknowledged') {
    throw conflict('RESULT_ALREADY_ACKNOWLEDGED', 'This result has already been acknowledged');
  }
  if (order.status !== 'resulted') {
    throw conflict('STATE_TRANSITION_INVALID', 'No result has been filed for this order yet');
  }

  const updated = await prisma.investigationOrder.update({
    where: { id: orderId },
    data: {
      status: 'acknowledged',
      acknowledgedById: caller.cpid,
      acknowledgedAt: new Date(),
      version: { increment: 1 },
    },
    include: { values: true },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'investigation.acknowledged',
    entityType: 'investigation_orders', entityId: orderId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseOrder(updated);
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/diagnostics.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as investigations from '../services/investigation.service.js';
import {
  createOrderSchema, fileResultSchema, listOrdersQuery,
} from '../types/diagnostics.types.js';

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

export const create = handle(
  (req, res) => investigations.createOrder(caller(req), createOrderSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => investigations.listOrders(caller(req), listOrdersQuery.parse(req.query)));

export const getOne = handle((req) => investigations.getOrder(pathParam(req, 'order_id'), caller(req)));

export const fileResult = handle(
  (req, res) => investigations.fileResult(
    pathParam(req, 'order_id'), caller(req), fileResultSchema.parse(req.body), meta(req, res),
  ), 201,
);

export const acknowledge = handle(
  (req, res) => investigations.acknowledgeResult(pathParam(req, 'order_id'), caller(req), meta(req, res)),
);
TS

cat > "$SVC/src/routes/diagnostics.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/diagnostics.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const diagnosticsRouter = Router();

diagnosticsRouter.post('/investigation-orders', requireAuth, idempotency, c.create);
diagnosticsRouter.get('/investigation-orders', requireAuth, c.list);
diagnosticsRouter.get('/investigation-orders/:order_id', requireAuth, c.getOne);
diagnosticsRouter.post('/investigation-orders/:order_id/results', requireAuth, idempotency, c.fileResult);
diagnosticsRouter.post('/investigation-orders/:order_id/acknowledge', requireAuth, c.acknowledge);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { diagnosticsRouter } from './routes/diagnostics.routes.js';

const service = createService({
  name: 'diagnostics',
  port: env.PORT,
  routers: [diagnosticsRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4013"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/diagnostics.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { computeFlag, isCriticalFlag } from '../engine/resultFlag.js';
import * as investigations from '../services/investigation.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const orderIds: string[] = [];

after(async () => {
  for (const id of orderIds) {
    await prisma.investigationValue.deleteMany({ where: { orderId: id } }).catch(() => undefined);
    await prisma.investigationOrder.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Dx Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Dx Test' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  return { user, profile, thread };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Dx Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('result flag engine', () => {
  it('flags a value inside all bounds as normal', () => {
    assert.equal(computeFlag({ value: '4.2', referenceLow: 3.5, referenceHigh: 5.0 }), 'normal');
  });

  it('flags high before critical when only high is breached', () => {
    assert.equal(computeFlag({ value: '5.6', referenceLow: 3.5, referenceHigh: 5.0, criticalHigh: 6.5 }), 'high');
  });

  it('flags critical_high when the critical bound is crossed', () => {
    const flag = computeFlag({ value: '6.8', referenceLow: 3.5, referenceHigh: 5.0, criticalHigh: 6.5 });
    assert.equal(flag, 'critical_high');
    assert.equal(isCriticalFlag(flag), true);
  });

  it('flags critical_low symmetrically', () => {
    assert.equal(computeFlag({ value: '1.9', referenceLow: 3.5, criticalLow: 2.0 }), 'critical_low');
  });

  it('defaults a non-numeric value to normal rather than guessing', () => {
    assert.equal(computeFlag({ value: 'positive', referenceLow: 0, referenceHigh: 10 }), 'normal');
  });
});

describe('ordering', () => {
  it('creates an order for the thread\u2019s patient', async () => {
    const { thread, profile } = await makePatient();
    const clinician = await makeClinician();

    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    assert.equal(order.patient_profile_id, profile.id);
    assert.equal(order.status, 'ordered');
  });

  it('refuses a non-clinician', async () => {
    const { thread } = await makePatient();
    await assert.rejects(
      () => investigations.createOrder(
        { sub: randomUUID(), role: 'patient' },
        { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
        meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('filing results', () => {
  it('computes is_critical server-side from a breached critical bound', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'K', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    const result = await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Potassium', value: '6.8', reference_low: 3.5, reference_high: 5.0, critical_high: 6.5 }] },
      meta,
    );

    assert.equal(result.is_critical, true);
    assert.equal(result.values[0]!.flag, 'critical_high');

    const auditEntries = await prisma.auditLog.count({ where: { action: 'investigation.critical_result_filed', entityId: order.id } });
    assert.equal(auditEntries, 1);
  });

  it('does not mark a normal result critical', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    const result = await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5', reference_low: 12, reference_high: 16 }] },
      meta,
    );
    assert.equal(result.is_critical, false);
  });

  it('refuses to file a result twice', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
    );

    await assert.rejects(
      () => investigations.fileResult(
        order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
        { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('acknowledging', () => {
  it('closes the loop on a critical result', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'K', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Potassium', value: '6.8', critical_high: 6.5 }] }, meta,
    );

    const acknowledged = await investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta);
    assert.equal(acknowledged.status, 'acknowledged');
    assert.ok(acknowledged.acknowledged_at);
  });

  it('refuses to acknowledge before a result exists', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    await assert.rejects(
      () => investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses to acknowledge the same result twice', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
    );
    await investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta);

    await assert.rejects(
      () => investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta),
      (e: AppError) => e.code === 'RESULT_ALREADY_ACKNOWLEDGED',
    );
  });
});

describe('visibility', () => {
  it('refuses a stranger reading someone else\u2019s order', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    await assert.rejects(
      () => investigations.getOrder(order.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/diagnostics exec tsc --noEmit"
echo "  pnpm --filter @a-health/diagnostics test"
