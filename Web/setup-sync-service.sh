#!/usr/bin/env bash
#
# Builds services/sync — the read half (GET /sync/changes) and write half
# (POST /sync/batch) of offline support.
#
# The write half is deliberately NOT a generic tunnel — the contract's own
# text says so: "Only the operations listed in SyncOperation.path are
# permitted here." Every queued write is replayed against the SAME
# allow-listed internal endpoint the app would have called directly, using
# the caller's own forwarded token — exactly the "one implementation of the
# business rules" principle gateway follows, applied to offline replay
# instead of USSD.
#
# Run from the repo root:
#   bash setup-sync-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/sync"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in VALIDATION_FAILED NOT_FOUND FORBIDDEN; do
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
pkg.name = pkg.name || '@a-health/sync';
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
  PORT: z.coerce.number().default(4022),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),

  CONSULTATION_SERVICE_URL: z.string().default('http://localhost:4005'),
  MESSAGING_SERVICE_URL: z.string().default('http://localhost:4006'),
  FOLLOWUP_SERVICE_URL: z.string().default('http://localhost:4007'),
  APPOINTMENT_SERVICE_URL: z.string().default('http://localhost:4004'),

  /** A first sync (no cursor) excludes closed threads older than this. */
  SNAPSHOT_WINDOW_DAYS: z.coerce.number().default(90),
});

export const env = envSchema.parse(process.env);
TS

# --- entity fetchers: real snapshot lookups for a bounded, honest subset ----
cat > "$SVC/src/services/entityFetchers.ts" << 'TS'
import { prisma } from '@a-health/database';

/**
 * Fetches the current live snapshot of one changed row, for exactly the
 * entities this service knows how to serialise. Deliberately not generic:
 * covering all seventeen SyncEntity values honestly, one real fetcher at a
 * time, matches how research and surveillance were scoped — a documented,
 * incremental subset rather than a claim of full coverage that isn't there.
 * An entity with no fetcher here is simply omitted from a sync response,
 * not silently faked.
 */
export type EntityFetcher = (id: string) => Promise<Record<string, unknown> | null>;

export const ENTITY_FETCHERS: Partial<Record<string, EntityFetcher>> = {
  care_threads: async (id) => {
    const row = await prisma.careThread.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, patient_profile_id: row.patientProfileId, status: row.status,
      reason_summary: row.reasonSummary, latest_consultation_id: row.latestConsultationId,
      open_consultation_count: row.openConsultationCount,
      opened_at: row.openedAt.toISOString(), closed_at: row.closedAt?.toISOString() ?? null,
    };
  },
  consultation_requests: async (id) => {
    const row = await prisma.consultationRequest.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, care_thread_id: row.careThreadId, patient_profile_id: row.patientProfileId,
      assigned_clinician_id: row.assignedClinicianId, status: row.status,
      urgency_level: row.urgencyLevel, channel: row.channel, modality: row.modality,
      sla_deadline_at: row.slaDeadlineAt.toISOString(),
    };
  },
  appointments: async (id) => {
    const row = await prisma.appointment.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, slot_id: row.slotId, patient_profile_id: row.patientProfileId,
      clinician_id: row.clinicianId, starts_at: row.startsAt.toISOString(),
      duration_minutes: row.durationMin, status: row.status,
    };
  },
  messages: async (id) => {
    const row = await prisma.message.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, care_thread_id: row.careThreadId, consultation_id: row.consultationId,
      sender_user_id: row.senderUserId, body: row.body, attachment_key: row.attachmentKey,
      read_at: row.readAt?.toISOString() ?? null, created_at: row.createdAt.toISOString(),
    };
  },
  adherence_logs: async (id) => {
    const row = await prisma.adherenceLog.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, prescription_item_id: row.prescriptionItemId, patient_profile_id: row.patientProfileId,
      medication_name: row.medicationName, dosage: row.dosage,
      scheduled_at: row.scheduledAt.toISOString(), reported_status: row.reportedStatus,
      reported_at: row.reportedAt?.toISOString() ?? null,
    };
  },
  check_ins: async (id) => {
    const row = await prisma.checkIn.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, follow_up_cycle_id: row.followUpCycleId, care_thread_id: row.careThreadId,
      scheduled_at: row.scheduledAt.toISOString(), status: row.status,
      is_deviation: row.isDeviation, responded_at: row.respondedAt?.toISOString() ?? null,
    };
  },
  patient_profiles: async (id) => {
    const row = await prisma.patientProfile.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id, full_name: row.fullName, date_of_birth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sex: row.sex, region_code: row.regionCode,
    };
  },
};
TS

# --- read half: getSyncChanges ------------------------------------------------
cat > "$SVC/src/services/changes.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { ENTITY_FETCHERS } from './entityFetchers.js';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }

function encodeCursor(seq: bigint): string {
  return Buffer.from(seq.toString()).toString('base64url');
}
function decodeCursor(cursor: string): bigint {
  return BigInt(Buffer.from(cursor, 'base64url').toString('utf8'));
}

/**
 * The read half. Visibility is scoped the same way every other list
 * endpoint in this platform is: a patient sees their own patientProfileId,
 * a clinician sees rows tagged with their clinicianId, admin sees all.
 *
 * Within the returned page, only the LATEST change per (entity, entityId) is
 * emitted — a client rebuilding local state needs current truth, not a full
 * replay of every intermediate version, and re-fetching the same row's
 * current body three times because it changed three times serves nobody.
 * If that latest change is a delete, a tombstone is emitted with no data;
 * otherwise the row's current live body is fetched fresh, never served from
 * the change-log entry itself (which never stored a snapshot to begin with).
 */
export async function getSyncChanges(
  caller: Caller,
  query: { cursor?: string; entities?: string[]; limit: number },
) {
  const afterSeq = query.cursor ? decodeCursor(query.cursor) : null;

  const visibility =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { clinicianId: caller.cpid }
        : caller.ppid
          ? { patientProfileId: caller.ppid }
          : { patientProfileId: '__none__' };

  const isFirstSync = afterSeq === null;
  const snapshotCutoff = new Date(Date.now() - env.SNAPSHOT_WINDOW_DAYS * 86_400_000);

  const rows = await prisma.changeLog.findMany({
    where: {
      ...visibility,
      ...(afterSeq !== null ? { seq: { gt: afterSeq } } : {}),
      ...(query.entities && query.entities.length > 0 ? { entity: { in: query.entities } } : {}),
      // A first sync returns only recent activity — a closed thread from
      // years ago is fetched on demand, not pushed to every fresh install.
      ...(isFirstSync ? { occurredAt: { gte: snapshotCutoff } } : {}),
    },
    orderBy: { seq: 'asc' },
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  // Collapse to the latest row per (entity, entityId) within this page.
  const latest = new Map<string, (typeof page)[number]>();
  for (const row of page) {
    latest.set(`${row.entity}:${row.entityId}`, row);
  }

  const data = await Promise.all(
    Array.from(latest.values()).map(async (row) => {
      const base = {
        entity: row.entity,
        id: row.entityId,
        op: row.op,
        version: row.version,
        updated_at: row.occurredAt.toISOString(),
      };
      if (row.op === 'delete') return base;

      const fetcher = ENTITY_FETCHERS[row.entity];
      const liveData = fetcher ? await fetcher(row.entityId) : null;
      return { ...base, ...(liveData ? { data: liveData } : {}) };
    }),
  );

  const lastSeq = page.length > 0 ? page[page.length - 1]!.seq : afterSeq ?? 0n;

  return {
    data,
    meta: {
      next_cursor: encodeCursor(lastSeq),
      has_more: hasMore,
      server_time: new Date().toISOString(),
    },
  };
}
TS

# --- write half: postSyncBatch -------------------------------------------
cat > "$SVC/src/services/batch.service.ts" << 'TS'
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('sync.batch');

export interface SyncOperation {
  op_id: string;
  method: 'POST' | 'PATCH';
  path: string;
  path_params?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface SyncOperationResult {
  op_id: string;
  status: number;
  body?: unknown;
  error?: { code?: string; message?: string };
}

/**
 * The allow-list itself. Every entry is a path that already exists,
 * unchanged, in the real contract — this is not a second implementation of
 * any of them, only a routing table telling this service which base URL
 * owns each one. Adding a new offline-capable write means adding one line
 * here and one line to the contract's own SyncOperation.path enum — never
 * the other way around, and never a path that isn't in both.
 */
const ALLOWED_OPERATIONS: Record<string, { baseUrl: () => string; template: string }> = {
  '/consultations': { baseUrl: () => env.CONSULTATION_SERVICE_URL, template: '/consultations' },
  '/care-threads/{care_thread_id}/messages': {
    baseUrl: () => env.MESSAGING_SERVICE_URL, template: '/care-threads/{care_thread_id}/messages',
  },
  '/consultations/{consultation_id}/complete': {
    baseUrl: () => env.CONSULTATION_SERVICE_URL, template: '/consultations/{consultation_id}/complete',
  },
  '/check-ins/{check_in_id}/respond': {
    baseUrl: () => env.FOLLOWUP_SERVICE_URL, template: '/check-ins/{check_in_id}/respond',
  },
  '/adherence-logs/{adherence_log_id}/confirm': {
    baseUrl: () => env.FOLLOWUP_SERVICE_URL, template: '/adherence-logs/{adherence_log_id}/confirm',
  },
  '/appointments': { baseUrl: () => env.APPOINTMENT_SERVICE_URL, template: '/appointments' },
  '/appointments/{appointment_id}/cancel': {
    baseUrl: () => env.APPOINTMENT_SERVICE_URL, template: '/appointments/{appointment_id}/cancel',
  },
};

function buildPath(template: string, params: Record<string, string> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params?.[key];
    if (!value) throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

/**
 * Replays one queued operation against the same endpoint the app would have
 * called live, using op_id as the Idempotency-Key — exactly the key that was
 * generated when the user originally acted, so replaying the same entry
 * twice (a client retry, a batch resubmitted after a partial failure) is
 * always safe, never a duplicate write.
 */
async function applyOne(op: SyncOperation, authHeader: string): Promise<SyncOperationResult> {
  const route = ALLOWED_OPERATIONS[op.path];
  if (!route) {
    return { op_id: op.op_id, status: 422, error: { code: 'VALIDATION_FAILED', message: `Path not permitted for offline sync: ${op.path}` } };
  }

  let url: string;
  try {
    url = `${route.baseUrl()}${buildPath(route.template, op.path_params)}`;
  } catch (err) {
    return { op_id: op.op_id, status: 422, error: { code: 'VALIDATION_FAILED', message: String(err) } };
  }

  try {
    const response = await fetch(url, {
      method: op.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'Idempotency-Key': op.op_id,
      },
      body: op.body ? JSON.stringify(op.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => undefined);
    if (response.ok) return { op_id: op.op_id, status: response.status, body };
    const errBody = body as { error?: { code?: string; message?: string } } | undefined;
    return { op_id: op.op_id, status: response.status, body, error: errBody?.error };
  } catch (err) {
    logger.error('offline replay failed', { path: op.path, err: String(err) });
    return { op_id: op.op_id, status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: String(err) } };
  }
}

/**
 * Applies every operation in order, independently — a failure at index 3
 * never rolls back 0-2, matching the contract's own description exactly.
 * Sequential, not parallel: submission order is the order the user actually
 * did things in, and a later operation may depend on an earlier one having
 * already landed (e.g. messaging into a thread a just-created consultation
 * opened).
 */
export async function applyBatch(operations: SyncOperation[], authHeader: string): Promise<SyncOperationResult[]> {
  const results: SyncOperationResult[] = [];
  for (const op of operations) {
    results.push(await applyOne(op, authHeader));
  }
  return results;
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/types/sync.types.ts" << 'TS'
import { z } from 'zod';

export const getChangesQuery = z.object({
  cursor: z.string().optional(),
  entities: z.union([z.string(), z.array(z.string())]).optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const syncOperationSchema = z.object({
  op_id: z.string().uuid(),
  method: z.enum(['POST', 'PATCH']),
  path: z.string(),
  path_params: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const postBatchSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(100),
});
TS

cat > "$SVC/src/controllers/sync.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { getSyncChanges } from '../services/changes.service.js';
import { applyBatch } from '../services/batch.service.js';
import { getChangesQuery, postBatchSchema } from '../types/sync.types.js';

export async function getChanges(req: Request, res: Response, next: NextFunction) {
  try {
    const query = getChangesQuery.parse(req.query);
    const caller = { sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid };
    res.status(200).json(await getSyncChanges(caller, query));
  } catch (err) {
    next(err);
  }
}

export async function postBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const input = postBatchSchema.parse(req.body);
    const authHeader = req.header('Authorization') ?? '';
    const results = await applyBatch(input.operations, authHeader);
    res.status(207).json({ results });
  } catch (err) {
    next(err);
  }
}
TS

cat > "$SVC/src/routes/sync.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/sync.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const syncRouter = Router();

syncRouter.get('/sync/changes', requireAuth, c.getChanges);
syncRouter.post('/sync/batch', requireAuth, c.postBatch);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { syncRouter } from './routes/sync.routes.js';

const service = createService({
  name: 'sync',
  port: env.PORT,
  routers: [syncRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4022"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "CONSULTATION_SERVICE_URL=http://localhost:4005"
    echo "MESSAGING_SERVICE_URL=http://localhost:4006"
    echo "FOLLOWUP_SERVICE_URL=http://localhost:4007"
    echo "APPOINTMENT_SERVICE_URL=http://localhost:4004"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/sync.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { getSyncChanges } from '../services/changes.service.js';
import { applyBatch } from '../services/batch.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const threadIds: string[] = [];
const changeLogSeqs: bigint[] = [];

after(async () => {
  for (const seq of changeLogSeqs) {
    await prisma.changeLog.delete({ where: { seq } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Sync Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Sync Test' } });
  return { user, profile };
}

async function logChange(entity: string, entityId: string, op: 'create' | 'update' | 'delete', patientProfileId: string, version = 1) {
  const row = await prisma.changeLog.create({
    data: { entity, entityId, op: op as never, version, patientProfileId },
  });
  changeLogSeqs.push(row.seq);
  return row;
}

describe('reading changes', () => {
  it('returns a live snapshot for a create, scoped to the caller', async () => {
    const { profile } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, reasonSummary: 'test' } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', profile.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const change = result.data.find((c) => (c as { id: string }).id === thread.id);
    assert.ok(change);
    assert.equal((change as { op: string }).op, 'create');
    assert.ok('data' in change!);
  });

  it('emits a tombstone with no data for a delete', async () => {
    const { profile } = await makePatient();
    const fakeId = randomUUID();
    await logChange('care_threads', fakeId, 'delete', profile.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const change = result.data.find((c) => (c as { id: string }).id === fakeId);
    assert.ok(change);
    assert.equal((change as { op: string }).op, 'delete');
    assert.ok(!('data' in change!));
  });

  it('never returns another patient\u2019s changes', async () => {
    const { profile: mine } = await makePatient();
    const { profile: theirs } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: theirs.id } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', theirs.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: mine.id }, { limit: 50 });
    assert.ok(!result.data.some((c) => (c as { id: string }).id === thread.id));
  });

  it('collapses multiple changes to the same entity into one, keeping the latest', async () => {
    const { profile } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', profile.id, 1);
    await logChange('care_threads', thread.id, 'update', profile.id, 2);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const matches = result.data.filter((c) => (c as { id: string }).id === thread.id);
    assert.equal(matches.length, 1);
    assert.equal((matches[0] as { op: string }).op, 'update');
  });

  it('paginates with a cursor that advances on the next call', async () => {
    const { profile } = await makePatient();
    for (let i = 0; i < 3; i += 1) {
      const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
      threadIds.push(thread.id);
      await logChange('care_threads', thread.id, 'create', profile.id);
    }

    const first = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 2 });
    assert.equal(first.data.length, 2);
    assert.equal(first.meta.has_more, true);

    const second = await getSyncChanges(
      { sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 2, cursor: first.meta.next_cursor },
    );
    assert.ok(second.data.length >= 1);
  });
});

describe('applying a batch', () => {
  it('refuses a path that is not on the allow-list', async () => {
    const results = await applyBatch(
      [{ op_id: randomUUID(), method: 'POST', path: '/users/me/delete-everything' }],
      'Bearer fake-token',
    );
    assert.equal(results[0]!.status, 422);
    assert.equal(results[0]!.error?.code, 'VALIDATION_FAILED');
  });

  it('reports a per-operation result for each entry, even when the service is unreachable', async () => {
    const results = await applyBatch(
      [
        { op_id: randomUUID(), method: 'POST', path: '/appointments/{appointment_id}/cancel', path_params: { appointment_id: randomUUID() } },
        { op_id: randomUUID(), method: 'POST', path: '/consultations' },
      ],
      'Bearer fake-token',
    );
    assert.equal(results.length, 2);
    for (const r of results) assert.ok(typeof r.status === 'number');
  });

  it('fails one operation without blocking the next', async () => {
    const results = await applyBatch(
      [
        { op_id: randomUUID(), method: 'POST', path: '/not-a-real-path' },
        { op_id: randomUUID(), method: 'POST', path: '/consultations' },
      ],
      'Bearer fake-token',
    );
    assert.equal(results[0]!.status, 422);
    assert.ok(results[1]); // second entry still processed independently
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/sync exec tsc --noEmit"
echo "  pnpm --filter @a-health/sync test"
