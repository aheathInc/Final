#!/usr/bin/env bash
#
# Builds services/research — de-identified aggregate datasets (blueprint
# §22). Ethics approval is checked before a query runs, and any result cell
# below the dataset's minimum size is suppressed rather than returned — a
# count of one in a district is an identity.
#
# Seeds one real, working dataset (consultation volumes by urgency/channel/
# status) bound to a real aggregate over ConsultationRequest, rather than a
# stub that accepts queries and never executes them.
#
# Run from the repo root:
#   bash setup-research-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/research"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in ETHICS_APPROVAL_REQUIRED NOT_FOUND FORBIDDEN ROLE_NOT_PERMITTED VALIDATION_FAILED NOT_RESOURCE_OWNER; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,scripts,engine,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/research';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts',
  'seed:datasets': 'node --import tsx src/scripts/seed-datasets.ts' };
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
  PORT: z.coerce.number().default(4019),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
});

export const env = envSchema.parse(process.env);
TS

# --- the one real, working dataset -------------------------------------------
cat > "$SVC/src/engine/datasets.ts" << 'TS'
/**
 * Binds a dataset name to a real, safely-aggregatable table and the fields
 * a researcher may group by. This is deliberately narrow: only categorical,
 * non-identifying fields (urgency, channel, status) are allow-listed —
 * nothing here can ever return a single patient's data, because the group-by
 * vocabulary itself has no identifying field to select.
 *
 * Adding a second dataset later means adding a second entry here with its
 * own allow-list, not opening the query interface up generically — a
 * generic "run any aggregate over any table" endpoint is a de-identification
 * hole waiting to be found.
 */
export interface DatasetBinding {
  datasetName: string;
  allowedGroupFields: string[];
}

export const CONSULTATION_VOLUMES: DatasetBinding = {
  datasetName: 'Consultation volumes by urgency and channel',
  allowedGroupFields: ['urgencyLevel', 'channel', 'status'],
};

export const DATASET_BINDINGS: Record<string, DatasetBinding> = {
  [CONSULTATION_VOLUMES.datasetName]: CONSULTATION_VOLUMES,
};
TS

cat > "$SVC/src/services/seedDatasets.ts" << 'TS'
import { prisma } from '@a-health/database';
import { CONSULTATION_VOLUMES } from '../engine/datasets.js';

export async function seedDatasets(): Promise<{ inserted: number; skipped: number }> {
  const existing = await prisma.researchDataset.findUnique({ where: { name: CONSULTATION_VOLUMES.datasetName } });
  if (existing) return { inserted: 0, skipped: 1 };

  await prisma.researchDataset.create({
    data: {
      name: CONSULTATION_VOLUMES.datasetName,
      description: 'Counts of consultations grouped by urgency level, channel, and status. No patient-identifying field is queryable.',
      deidentificationMethod: 'aggregation-only; no row-level export',
      kAnonymity: 5,
      minimumCellSize: 5,
      requiresEthicsApproval: true,
    },
  });
  return { inserted: 1, skipped: 0 };
}
TS

cat > "$SVC/src/scripts/seed-datasets.ts" << 'TS'
import { prisma } from '@a-health/database';
import { seedDatasets } from '../services/seedDatasets.js';

const result = await seedDatasets();
console.log(JSON.stringify(result));
await prisma.$disconnect();
TS

# --- query service ------------------------------------------------------------
cat > "$SVC/src/services/query.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { AppError, appendAudit, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { DATASET_BINDINGS } from '../engine/datasets.js';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function assertResearcher(caller: Caller) {
  if (caller.role !== 'researcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a registered researcher may query a dataset');
  }
}

function serialiseDataset(d: {
  id: string; name: string; description: string; deidentificationMethod: string;
  kAnonymity: number; minimumCellSize: number; requiresEthicsApproval: boolean;
  recordCount: number; isActive: boolean;
}) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    deidentification_method: d.deidentificationMethod,
    k_anonymity: d.kAnonymity,
    minimum_cell_size: d.minimumCellSize,
    requires_ethics_approval: d.requiresEthicsApproval,
    record_count: d.recordCount,
  };
}

export async function listDatasets(caller: Caller) {
  assertResearcher(caller);
  const rows = await prisma.researchDataset.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return { data: rows.map(serialiseDataset) };
}

function serialiseQuery(q: {
  id: string; datasetId: string; researcherId: string; ethicsApprovalRef: string;
  spec: unknown; status: string; rows: unknown; suppressedCells: number;
  submittedAt: Date; completedAt: Date | null; version: number;
}) {
  return {
    id: q.id,
    dataset_id: q.datasetId,
    researcher_id: q.researcherId,
    ethics_approval_ref: q.ethicsApprovalRef,
    query: q.spec,
    status: q.status,
    rows: q.rows ?? [],
    suppressed_cells: q.suppressedCells,
    submitted_at: q.submittedAt.toISOString(),
    completed_at: q.completedAt?.toISOString() ?? null,
  };
}

/**
 * Runs an aggregate against the dataset's bound table, using only its
 * allow-listed group-by fields. Any resulting cell below the dataset's
 * minimum size is suppressed before the row is ever written to the query
 * record — a suppressed cell is never stored anywhere, not stored-then-hidden.
 *
 * Executed synchronously: the one seeded dataset is a fast, in-database
 * aggregate. A dataset requiring heavier computation would move this to a
 * worker and leave status='running' in between, without changing this
 * function's contract.
 */
export async function submitQuery(
  caller: Caller,
  input: { dataset_id: string; ethics_approval_ref: string; query: { measure: string; group_by: string[] } },
  meta: Meta,
) {
  assertResearcher(caller);

  const dataset = await prisma.researchDataset.findUnique({ where: { id: input.dataset_id } });
  if (!dataset) throw notFound('Dataset not found');
  if (dataset.requiresEthicsApproval && !input.ethics_approval_ref.trim()) {
    throw new AppError(
      'ETHICS_APPROVAL_REQUIRED', 422,
      'An ethics approval reference is required for this dataset',
      'ethics_approval_ref',
    );
  }

  const binding = DATASET_BINDINGS[dataset.name];
  if (!binding) {
    throw unprocessable('This dataset has no query binding configured', 'dataset_id');
  }
  const invalidFields = input.query.group_by.filter((f) => !binding.allowedGroupFields.includes(f));
  if (invalidFields.length > 0) {
    throw unprocessable(`These fields cannot be grouped by: ${invalidFields.join(', ')}`, 'query.group_by');
  }

  const grouped = await prisma.consultationRequest.groupBy({
    by: input.query.group_by as never,
    _count: { _all: true },
  });

  let suppressedCells = 0;
  const rows = grouped
    .filter((row) => {
      if (row._count._all < dataset.minimumCellSize) {
        suppressedCells += 1;
        return false;
      }
      return true;
    })
    .map((row) => {
      const dims: Record<string, unknown> = {};
      for (const field of input.query.group_by) dims[field] = (row as Record<string, unknown>)[field];
      return { ...dims, count: row._count._all };
    });

  const query = await prisma.researchQuery.create({
    data: {
      datasetId: input.dataset_id,
      researcherId: caller.sub,
      ethicsApprovalRef: input.ethics_approval_ref,
      spec: input.query as never,
      status: 'complete',
      rows: rows as never,
      suppressedCells,
      completedAt: new Date(),
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'research.query_run',
    entityType: 'research_queries', entityId: query.id,
    metadata: { datasetId: input.dataset_id, ethicsApprovalRef: input.ethics_approval_ref, suppressedCells },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseQuery(query);
}

export async function getQuery(id: string, caller: Caller) {
  assertResearcher(caller);
  const query = await prisma.researchQuery.findUnique({ where: { id } });
  if (!query) throw notFound('Query not found');
  if (caller.role !== 'platform_admin' && query.researcherId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'This query is not yours');
  }
  return serialiseQuery(query);
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/research.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as queries from '../services/query.service.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listDatasets = handle((req) => queries.listDatasets(caller(req)));

export const submitQuery = handle((req, res) => queries.submitQuery(caller(req), req.body, meta(req, res)), 202);

export const getQuery = handle((req) => queries.getQuery(pathParam(req, 'query_id'), caller(req)));
TS

cat > "$SVC/src/routes/research.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/research.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const researchRouter = Router();

researchRouter.get('/research/datasets', requireAuth, c.listDatasets);
researchRouter.post('/research/queries', requireAuth, idempotency, c.submitQuery);
researchRouter.get('/research/queries/:query_id', requireAuth, c.getQuery);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { researchRouter } from './routes/research.routes.js';
import { seedDatasets } from './services/seedDatasets.js';

const service = createService({
  name: 'research',
  port: env.PORT,
  routers: [researchRouter],
  development: env.NODE_ENV === 'development',
});

await seedDatasets();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4019"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/research.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { seedDatasets } from '../services/seedDatasets.js';
import { CONSULTATION_VOLUMES } from '../engine/datasets.js';
import * as queries from '../services/query.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const researcher = { sub: randomUUID(), role: 'researcher' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const queryIds: string[] = [];

after(async () => {
  for (const id of queryIds) {
    await prisma.researchQuery.delete({ where: { id } }).catch(() => undefined);
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

async function makeConsultation(urgency: 'routine' | 'urgent' | 'emergency', channel: 'app' | 'sms' = 'app') {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Research Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Research Test' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id,
      channel: channel as never, modality: 'chat', urgencyLevel: urgency as never,
      triageRuleVersion: 'test', status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  return consultation;
}

describe('datasets', () => {
  it('seeds the consultation-volumes dataset idempotently', async () => {
    const first = await seedDatasets();
    const second = await seedDatasets();
    assert.ok(first.inserted + second.skipped >= 1);
    assert.equal(second.inserted, 0);
  });

  it('refuses a non-researcher listing datasets', async () => {
    await assert.rejects(
      () => queries.listDatasets({ sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('queries', () => {
  it('requires an ethics approval reference', async () => {
    await seedDatasets();
    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });

    await assert.rejects(
      () => queries.submitQuery(researcher, { dataset_id: dataset.id, ethics_approval_ref: '', query: { measure: 'count', group_by: ['urgencyLevel'] } }, meta),
      (e: AppError) => e.code === 'ETHICS_APPROVAL_REQUIRED',
    );
  });

  it('refuses grouping by a field not on the allow-list', async () => {
    await seedDatasets();
    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });

    await assert.rejects(
      () => queries.submitQuery(researcher, { dataset_id: dataset.id, ethics_approval_ref: 'ETH-1', query: { measure: 'count', group_by: ['patientProfileId'] } }, meta),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('suppresses a cell below the minimum size and reports it', async () => {
    await seedDatasets();
    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });
    await prisma.researchDataset.update({ where: { id: dataset.id }, data: { minimumCellSize: 3 } });

    // Exactly one emergency consultation — below the threshold of 3.
    await makeConsultation('emergency');

    const result = await queries.submitQuery(
      researcher, { dataset_id: dataset.id, ethics_approval_ref: 'ETH-2', query: { measure: 'count', group_by: ['urgencyLevel'] } }, meta,
    );
    queryIds.push(result.id);

    const rows = result.rows as { urgencyLevel: string; count: number }[];
    assert.ok(!rows.some((r) => r.urgencyLevel === 'emergency'));
    assert.ok(result.suppressed_cells >= 1);
  });

  it('refuses a stranger reading someone else\u2019s query', async () => {
    await seedDatasets();
    const dataset = await prisma.researchDataset.findUniqueOrThrow({ where: { name: CONSULTATION_VOLUMES.datasetName } });
    const result = await queries.submitQuery(
      researcher, { dataset_id: dataset.id, ethics_approval_ref: 'ETH-3', query: { measure: 'count', group_by: ['channel'] } }, meta,
    );
    queryIds.push(result.id);

    await assert.rejects(
      () => queries.getQuery(result.id, { sub: randomUUID(), role: 'researcher' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/research exec tsc --noEmit"
echo "  pnpm --filter @a-health/research test"
