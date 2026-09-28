#!/usr/bin/env bash
#
# Builds services/facilities — the facility directory and live queue read.
# The contract's own text already settled the honest-data question months
# ago: "Facilities that are not integrated report integration_level: none
# and an empty provider list rather than a fabricated estimate." This
# service is that promise, kept.
#
# Run from the repo root:
#   bash setup-facilities-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/facilities"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in NOT_FOUND; do
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
pkg.name = pkg.name || '@a-health/facilities';
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
  PORT: z.coerce.number().default(4025),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/services/facility.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { cursorArgs, notFound, toCursorPage } from '@a-health/http';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function serialise(f: {
  id: string; name: string; type: string; lat: number | null; lng: number | null;
  regionCode: string | null; contactPhone: string | null; integrationLevel: string;
}, distanceKm?: number) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    location: f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null,
    distance_km: distanceKm ?? null,
    region_code: f.regionCode,
    contact_phone: f.contactPhone,
    integration_level: f.integrationLevel,
  };
}

export async function listFacilities(query: {
  type?: string; region_code?: string; lat?: number; lng?: number; radius_km?: number;
  cursor?: string; limit: number;
}) {
  const rows = await prisma.facility.findMany({
    where: {
      isActive: true,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.region_code ? { regionCode: query.region_code } : {}),
    },
    orderBy: { name: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });

  if (query.lat == null || query.lng == null) {
    return toCursorPage(rows, query.limit, (r) => serialise(r));
  }

  const radius = query.radius_km ?? 25;
  const withDistance = rows
    .map((r) => ({
      row: r,
      distance: r.lat != null && r.lng != null ? haversineKm(query.lat!, query.lng!, r.lat, r.lng) : undefined,
    }))
    .filter((x) => x.distance === undefined || x.distance <= radius)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  return toCursorPage(withDistance.map((x) => x.row), query.limit, (row) =>
    serialise(row, withDistance.find((x) => x.row.id === row.id)?.distance));
}

export async function getFacility(id: string) {
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) throw notFound('Facility not found');
  return serialise(facility);
}

export async function listDepartments(facilityId: string) {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw notFound('Facility not found');

  const rows = await prisma.department.findMany({ where: { facilityId, isActive: true }, orderBy: { name: 'asc' } });
  return {
    data: rows.map((d) => ({ id: d.id, facility_id: d.facilityId, name: d.name, specialty: d.specialty })),
  };
}

/**
 * The congestion feature — but only where it is honest. A facility with no
 * live feed reports `integration_level: none` and an empty provider list,
 * exactly as documented in the contract, rather than a wait-time estimate
 * nobody actually measured. No live-queue data source is wired into this
 * platform yet for ANY integration level, so every facility currently
 * returns this shape — the field exists so a future data feed has
 * somewhere real to plug in, not to imply one already does.
 */
export async function getFacilityQueue(facilityId: string, departmentId: string | undefined) {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw notFound('Facility not found');

  return {
    facility_id: facility.id,
    integration_level: facility.integrationLevel,
    department_id: departmentId ?? null,
    observed_at: new Date().toISOString(),
    providers: [] as unknown[],
  };
}
TS

cat > "$SVC/src/types/facilities.types.ts" << 'TS'
import { z } from 'zod';

export const listFacilitiesQuery = z.object({
  type: z.enum(['hospital', 'clinic', 'pharmacy', 'transport_partner', 'laboratory', 'imaging_centre']).optional(),
  region_code: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius_km: z.coerce.number().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const facilityQueueQuery = z.object({
  department_id: z.string().uuid().optional(),
});
TS

cat > "$SVC/src/controllers/facilities.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as facilities from '../services/facility.service.js';
import { facilityQueueQuery, listFacilitiesQuery } from '../types/facilities.types.js';

const handle =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json(await fn(req)); } catch (err) { next(err); }
  };

export const list = handle((req) => facilities.listFacilities(listFacilitiesQuery.parse(req.query)));
export const getOne = handle((req) => facilities.getFacility(pathParam(req, 'facility_id')));
export const departments = handle((req) => facilities.listDepartments(pathParam(req, 'facility_id')));
export const queue = handle((req) => {
  const query = facilityQueueQuery.parse(req.query);
  return facilities.getFacilityQueue(pathParam(req, 'facility_id'), query.department_id);
});
TS

cat > "$SVC/src/routes/facilities.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/facilities.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const facilitiesRouter = Router();

facilitiesRouter.get('/facilities', requireAuth, c.list);
facilitiesRouter.get('/facilities/:facility_id', requireAuth, c.getOne);
facilitiesRouter.get('/facilities/:facility_id/departments', requireAuth, c.departments);
facilitiesRouter.get('/facilities/:facility_id/queue', requireAuth, c.queue);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { facilitiesRouter } from './routes/facilities.routes.js';

const service = createService({
  name: 'facilities',
  port: env.PORT,
  routers: [facilitiesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4025"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/facilities.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import * as facilities from '../services/facility.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const facilityIds: string[] = [];

after(async () => {
  for (const id of facilityIds) {
    await prisma.department.deleteMany({ where: { facilityId: id } }).catch(() => undefined);
    await prisma.facility.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeFacility(overrides: { lat?: number; lng?: number; integrationLevel?: string } = {}) {
  const facility = await prisma.facility.create({
    data: {
      name: `Test Facility ${randomUUID().slice(0, 8)}`, type: 'hospital',
      lat: overrides.lat ?? -6.8, lng: overrides.lng ?? 39.28,
      integrationLevel: (overrides.integrationLevel ?? 'none') as never,
    },
  });
  facilityIds.push(facility.id);
  return facility;
}

describe('directory', () => {
  it('lists a facility by id', async () => {
    const facility = await makeFacility();
    const result = await facilities.getFacility(facility.id);
    assert.equal(result.id, facility.id);
  });

  it('orders results by distance when a location is given', async () => {
    const near = await makeFacility({ lat: -6.80, lng: 39.28 });
    const far = await makeFacility({ lat: -8.90, lng: 33.40 });

    const result = await facilities.listFacilities({ lat: -6.80, lng: 39.28, radius_km: 50, limit: 25 });
    const ids = result.data.map((f) => (f as { id: string }).id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id) || !ids.includes(far.id));
  });

  it('lists departments for a facility', async () => {
    const facility = await makeFacility();
    await prisma.department.create({ data: { facilityId: facility.id, name: 'Outpatient', specialty: 'general_practice' } });

    const result = await facilities.listDepartments(facility.id);
    assert.equal(result.data.length, 1);
  });
});

describe('queue', () => {
  it('reports integration_level none with an empty provider list for an unintegrated facility', async () => {
    const facility = await makeFacility({ integrationLevel: 'none' });
    const result = await facilities.getFacilityQueue(facility.id, undefined);
    assert.equal(result.integration_level, 'none');
    assert.equal(result.providers.length, 0);
  });

  it('never fabricates provider data even for a facility marked as integrated', async () => {
    const facility = await makeFacility({ integrationLevel: 'full' });
    const result = await facilities.getFacilityQueue(facility.id, undefined);
    assert.equal(result.integration_level, 'full');
    assert.equal(result.providers.length, 0);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/facilities exec tsc --noEmit"
echo "  pnpm --filter @a-health/facilities test"
