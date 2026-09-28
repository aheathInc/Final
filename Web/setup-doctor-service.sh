#!/usr/bin/env bash
#
# Builds services/doctor — clinician verification, availability, and bookable
# slots. Small, and it is what unblocks consultation routing: the matching
# engine has nobody to rank until clinicians can be verified and go on duty.
#
# Also adds cursor pagination to packages/http, and two endpoints the contract
# was missing: an admin can approve a licence but had no way to find which
# licences were waiting.
#
# Run from the repo root:
#   bash setup-doctor-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/doctor"
HTTP="$ROOT/packages/http"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$HTTP/src/index.ts" ] || { echo "packages/http missing — run setup-shared-http.sh first."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

# ===========================================================================
# packages/http — cursor pagination, needed by every list endpoint from here on
# ===========================================================================
cat > "$HTTP/src/pagination.ts" << 'TS'
import { unprocessable } from './errors.js';

/**
 * Opaque cursor over a row id.
 *
 * Cursor rather than offset for anything that mutates while being read — a
 * clinician queue, a message thread, a sync feed. With offsets, a row inserted
 * between page one and page two shifts everything down and the reader silently
 * skips a record. In a queue of patients that is not a cosmetic bug.
 *
 * Base64 rather than the raw id so clients treat it as opaque and we stay free
 * to change what it encodes.
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const id = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!id) throw new Error('empty');
    return id;
  } catch {
    throw unprocessable('Cursor is not valid', 'cursor');
  }
}

export interface CursorPage<T> {
  data: T[];
  meta: { next_cursor: string | null; has_more: boolean };
}

/**
 * Takes one row more than asked for, uses its presence to answer has_more, and
 * drops it. Avoids a second COUNT query, which on a live queue would be both
 * expensive and immediately stale.
 */
export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  map?: (row: T) => unknown,
): CursorPage<unknown> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => (map ? map(r) : r)),
    meta: {
      next_cursor: hasMore && last ? encodeCursor(last.id) : null,
      has_more: hasMore,
    },
  };
}

/** Prisma take/cursor/skip arguments for a cursor page. */
export function cursorArgs(cursor: string | undefined, limit: number) {
  const id = decodeCursor(cursor);
  return {
    take: limit + 1,
    ...(id ? { cursor: { id }, skip: 1 } : {}),
  };
}
TS

node - "$HTTP/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("./pagination.js")) {
  s = s.replace("export * from './hash.js';", "export * from './hash.js';\nexport * from './pagination.js';");
  fs.writeFileSync(p, s);
  console.log('  pagination exported from packages/http');
}
NODE

# ===========================================================================
# services/doctor
# ===========================================================================
echo "Writing services/doctor…"

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* new file */ }

pkg.name = pkg.name || '@a-health/doctor';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = {
  ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts',
  build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts',
};
pkg.dependencies = {
  ...(pkg.dependencies || {}),
  '@a-health/database': 'workspace:*',
  '@a-health/http': 'workspace:*',
  '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2',
  express: '^5.1.0',
  zod: '^4.4.3',
};
pkg.devDependencies = {
  ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3',
  '@types/node': '^22.10.0',
  tsx: '^4.23.5',
  typescript: '^5.9.3',
};
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

# --- env -------------------------------------------------------------------
cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4003),

  DATABASE_URL: z.string(),

  // This service only verifies tokens; it never mints one. Sharing the secret
  // is what HS256 costs — see the RS256 note in packages/http/src/tokens.ts.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Longest slot a clinician may publish. Guards against a fat-finger 8h slot. */
  MAX_SLOT_MINUTES: z.coerce.number().default(120),
  /** How far ahead slots may be published. */
  MAX_SLOT_HORIZON_DAYS: z.coerce.number().default(90),
});

export const env = envSchema.parse(process.env);
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4003"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "ACCESS_TOKEN_TTL_SECONDS=900"
  } > "$SVC/.env"
  echo "  .env written (JWT_SECRET copied from auth — both services must agree)"
fi

# --- types -----------------------------------------------------------------
cat > "$SVC/src/types/doctor.types.ts" << 'TS'
import { z } from 'zod';

export const specialty = z.enum([
  'general_practice',
  'internal_medicine',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
  'psychiatry',
  'dermatology',
  'other',
]);

export const verificationStatus = z.enum(['pending', 'verified', 'rejected']);
export const modality = z.enum(['chat', 'voice', 'video', 'async']);

export const listCliniciansQuery = z.object({
  verification_status: verificationStatus.optional(),
  specialty: specialty.optional(),
  is_available: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const verificationDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(1000).optional(),
  })
  // A rejection a clinician cannot act on is a dead end, so the reason is
  // required rather than merely encouraged.
  .refine((v) => v.decision === 'approve' || (v.reason && v.reason.length > 0), {
    message: 'A reason is required when rejecting',
    path: ['reason'],
  });

export const availabilitySchema = z.object({
  is_available: z.boolean(),
  until: z.string().datetime().optional(),
});

export const publishSlotsSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  slots: z
    .array(
      z.object({
        starts_at: z.string().datetime(),
        duration_minutes: z.number().int().min(5).max(120),
        modality: modality.default('chat'),
      }),
    )
    .max(500),
});

export const slotsQuery = z.object({
  from: z.string().date(),
  to: z.string().date(),
});

export type PublishSlotsInput = z.infer<typeof publishSlotsSchema>;
TS

# --- clinician service -----------------------------------------------------
cat > "$SVC/src/services/clinician.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import {
  appendAudit,
  conflict,
  cursorArgs,
  forbidden,
  notFound,
  toCursorPage,
} from '@a-health/http';

export interface RequestMeta {
  ip?: string | null;
  requestId?: string | null;
}

function serialise(c: {
  id: string;
  userId: string;
  facilityId: string | null;
  licenseNumber: string;
  specialty: string;
  verificationStatus: string;
  rejectionReason: string | null;
  languagesSpoken: unknown;
  isAvailable: boolean;
  availableUntil: Date | null;
  currentLoad: number;
  ratingAvg: unknown;
  version: number;
  updatedAt: Date;
  user?: { fullName: string | null; email: string | null; status: string } | null;
}) {
  return {
    id: c.id,
    user_id: c.userId,
    facility_id: c.facilityId,
    license_number: c.licenseNumber,
    specialty: c.specialty,
    verification_status: c.verificationStatus,
    rejection_reason: c.rejectionReason,
    languages_spoken: c.languagesSpoken ?? [],
    is_available: c.isAvailable,
    available_until: c.availableUntil?.toISOString() ?? null,
    current_load: c.currentLoad,
    rating_avg: c.ratingAvg === null ? null : Number(c.ratingAvg),
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
    ...(c.user
      ? { full_name: c.user.fullName, email: c.user.email, account_status: c.user.status }
      : {}),
  };
}

/**
 * The queue an administrator actually works from.
 *
 * The contract described how to approve a licence but gave no way to find the
 * ones waiting, which made the approval endpoint unusable in practice.
 */
export async function listClinicians(query: {
  verification_status?: string;
  specialty?: string;
  is_available?: boolean;
  cursor?: string;
  limit: number;
}) {
  const rows = await prisma.clinicianProfile.findMany({
    where: {
      ...(query.verification_status
        ? { verificationStatus: query.verification_status as never }
        : {}),
      ...(query.specialty ? { specialty: query.specialty as never } : {}),
      ...(query.is_available !== undefined ? { isAvailable: query.is_available } : {}),
    },
    include: { user: { select: { fullName: true, email: true, status: true } } },
    orderBy: { createdAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

export async function getClinician(clinicianId: string, caller: { sub: string; role: string }) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianId },
    include: { user: { select: { fullName: true, email: true, status: true } } },
  });
  if (!clinician) throw notFound('Clinician not found');

  // A clinician may read their own record; anyone else needs an admin role.
  if (caller.role !== 'platform_admin' && clinician.userId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view another clinician’s record');
  }
  return serialise(clinician);
}

/**
 * Approving a licence is what makes a clinician real to the system: it is the
 * moment they become eligible for routing and able to sign a note. It also
 * activates the account — phone verification alone deliberately does not,
 * because possessing a handset is not a right to practise medicine.
 */
export async function decideVerification(
  clinicianId: string,
  adminUserId: string,
  decision: 'approve' | 'reject',
  reason: string | undefined,
  meta: RequestMeta,
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianId },
    include: { user: { select: { id: true, status: true, fullName: true, email: true } } },
  });
  if (!clinician) throw notFound('Clinician not found');

  if (clinician.verificationStatus === 'verified' && decision === 'approve') {
    throw conflict('STATE_TRANSITION_INVALID', 'This clinician is already verified');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.clinicianProfile.update({
      where: { id: clinicianId },
      data: {
        verificationStatus: decision === 'approve' ? 'verified' : 'rejected',
        rejectionReason: decision === 'reject' ? (reason ?? null) : null,
        // A rejected clinician must not stay on duty against a licence that is
        // no longer accepted.
        ...(decision === 'reject' ? { isAvailable: false } : {}),
        version: { increment: 1 },
      },
      include: { user: { select: { fullName: true, email: true, status: true } } },
    });

    if (decision === 'approve' && clinician.user.status === 'pending_verification') {
      await tx.user.update({
        where: { id: clinician.userId },
        data: { status: 'active', version: { increment: 1 } },
      });
    }

    return profile;
  });

  await appendAudit({
    actorUserId: adminUserId,
    action: decision === 'approve' ? 'clinician.verified' : 'clinician.rejected',
    entityType: 'clinician_profiles',
    entityId: clinicianId,
    reason: reason ?? null,
    metadata: { licenseNumber: clinician.licenseNumber, specialty: clinician.specialty },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return serialise(updated);
}

/**
 * Going off duty removes the clinician from the routing candidate pool. It
 * does not drop consultations already assigned — those must be completed or
 * explicitly reassigned, because a patient mid-conversation is not a queue
 * entry to be discarded.
 */
export async function setAvailability(
  clinicianProfileId: string,
  isAvailable: boolean,
  until: string | undefined,
  meta: RequestMeta,
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianProfileId },
  });
  if (!clinician) throw notFound('Clinician profile not found');
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const updated = await prisma.clinicianProfile.update({
    where: { id: clinicianProfileId },
    data: {
      isAvailable,
      availableUntil: until ? new Date(until) : null,
      version: { increment: 1 },
    },
    include: { user: { select: { fullName: true, email: true, status: true } } },
  });

  await appendAudit({
    actorUserId: clinician.userId,
    action: isAvailable ? 'clinician.on_duty' : 'clinician.off_duty',
    entityType: 'clinician_profiles',
    entityId: clinicianProfileId,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return serialise(updated);
}
TS

# --- slot service ----------------------------------------------------------
cat > "$SVC/src/services/slot.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';
import type { PublishSlotsInput } from '../types/doctor.types.js';

function serialise(s: {
  id: string;
  clinicianId: string;
  startsAt: Date;
  durationMin: number;
  modality: string;
  isBooked: boolean;
}) {
  return {
    id: s.id,
    clinician_id: s.clinicianId,
    starts_at: s.startsAt.toISOString(),
    duration_minutes: s.durationMin,
    modality: s.modality,
    is_booked: s.isBooked,
  };
}

export async function listSlots(clinicianId: string, from: string, to: string) {
  const clinician = await prisma.clinicianProfile.findUnique({ where: { id: clinicianId } });
  if (!clinician) throw notFound('Clinician not found');

  const rows = await prisma.slot.findMany({
    where: {
      clinicianId,
      isBooked: false,
      startsAt: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T23:59:59.999Z`),
        // A slot in the past is not bookable, whatever the requested window says.
        gt: new Date(),
      },
    },
    orderBy: { startsAt: 'asc' },
    take: 500,
  });

  return { data: rows.map(serialise) };
}

/**
 * Replaces the clinician's published slots inside a window.
 *
 * Booked slots are never removed. A patient holding an appointment is not
 * something a clinician can delete by republishing their calendar — cancelling
 * the appointment is a separate, visible act.
 */
export async function publishSlots(
  clinicianProfileId: string,
  input: PublishSlotsInput,
  now = new Date(),
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianProfileId },
  });
  if (!clinician) throw notFound('Clinician profile not found');
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const windowStart = new Date(`${input.from}T00:00:00.000Z`);
  const windowEnd = new Date(`${input.to}T23:59:59.999Z`);
  if (windowEnd < windowStart) throw unprocessable('`to` is before `from`', 'to');

  const horizon = new Date(now.getTime() + env.MAX_SLOT_HORIZON_DAYS * 86_400_000);
  if (windowEnd > horizon) {
    throw unprocessable(
      `Slots may only be published ${env.MAX_SLOT_HORIZON_DAYS} days ahead`,
      'to',
    );
  }

  const parsed = input.slots
    .map((s) => ({
      startsAt: new Date(s.starts_at),
      durationMin: s.duration_minutes,
      modality: s.modality,
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  for (const slot of parsed) {
    if (slot.startsAt < now) {
      throw conflict('SLOT_IN_PAST', 'A slot cannot start in the past', 'slots');
    }
    if (slot.startsAt < windowStart || slot.startsAt > windowEnd) {
      throw unprocessable('A slot falls outside the requested window', 'slots');
    }
    if (slot.durationMin > env.MAX_SLOT_MINUTES) {
      throw unprocessable(`A slot may not exceed ${env.MAX_SLOT_MINUTES} minutes`, 'slots');
    }
  }

  // Overlap is the failure the unique constraint on (clinician, starts_at) does
  // not catch: 09:00 for 30 minutes and 09:15 for 30 minutes have different
  // start times and still double-book the same person.
  for (let i = 1; i < parsed.length; i += 1) {
    const prev = parsed[i - 1]!;
    const cur = parsed[i]!;
    if (cur.startsAt.getTime() < prev.startsAt.getTime() + prev.durationMin * 60_000) {
      throw conflict('SLOT_UNAVAILABLE', 'Two published slots overlap', 'slots');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const booked = await tx.slot.findMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: true,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
    });

    await tx.slot.deleteMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: false,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
    });

    const bookedTimes = new Set(booked.map((b) => b.startsAt.getTime()));
    const toCreate = parsed.filter((s) => !bookedTimes.has(s.startsAt.getTime()));

    // A new slot must not overlap a booked one either.
    for (const s of toCreate) {
      for (const b of booked) {
        const overlap =
          s.startsAt.getTime() < b.startsAt.getTime() + b.durationMin * 60_000 &&
          b.startsAt.getTime() < s.startsAt.getTime() + s.durationMin * 60_000;
        if (overlap) {
          throw conflict(
            'SLOT_UNAVAILABLE',
            'A published slot overlaps an existing booking',
            'slots',
          );
        }
      }
    }

    await tx.slot.createMany({
      data: toCreate.map((s) => ({
        clinicianId: clinicianProfileId,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        modality: s.modality as never,
      })),
    });

    const published = await tx.slot.findMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: false,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { startsAt: 'asc' },
    });

    return { published, retained: booked };
  });

  return {
    published: result.published.map(serialise),
    retained: result.retained.map(serialise),
  };
}
TS

# --- controller ------------------------------------------------------------
cat > "$SVC/src/controllers/clinician.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '@a-health/http';
import * as clinicians from '../services/clinician.service.js';
import * as slots from '../services/slot.service.js';
import {
  availabilitySchema,
  listCliniciansQuery,
  publishSlotsSchema,
  slotsQuery,
  verificationDecisionSchema,
} from '../types/doctor.types.js';

const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

/** The clinician profile id lives on the token, so `me` needs no lookup. */
function ownProfileId(req: Request): string {
  const id = req.auth?.cpid;
  if (!id) throw forbidden('ROLE_NOT_PERMITTED', 'No clinician profile on this account');
  return id;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listCliniciansQuery.parse(req.query);
    res.status(200).json(await clinicians.listClinicians(query));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(
        await clinicians.getClinician(req.params.clinician_id!, {
          sub: req.auth!.sub,
          role: req.auth!.role,
        }),
      );
  } catch (err) {
    next(err);
  }
}

export async function decideVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const input = verificationDecisionSchema.parse(req.body);
    res
      .status(200)
      .json(
        await clinicians.decideVerification(
          req.params.clinician_id!,
          req.auth!.sub,
          input.decision,
          input.reason,
          meta(req, res),
        ),
      );
  } catch (err) {
    next(err);
  }
}

export async function setAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const input = availabilitySchema.parse(req.body);
    res
      .status(200)
      .json(
        await clinicians.setAvailability(
          ownProfileId(req),
          input.is_available,
          input.until,
          meta(req, res),
        ),
      );
  } catch (err) {
    next(err);
  }
}

export async function listSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const query = slotsQuery.parse(req.query);
    res.status(200).json(await slots.listSlots(req.params.clinician_id!, query.from, query.to));
  } catch (err) {
    next(err);
  }
}

export async function publishSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const input = publishSlotsSchema.parse(req.body);
    res.status(200).json(await slots.publishSlots(ownProfileId(req), input));
  } catch (err) {
    next(err);
  }
}
TS

# --- routes ----------------------------------------------------------------
cat > "$SVC/src/routes/clinician.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as controller from '../controllers/clinician.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});

const { requireAuth, requireRole, requireVerifiedClinician } = createAuthGuards(tokens);

export const clinicianRouter = Router();

// `me` routes are declared before `:clinician_id` so the literal wins the match.
clinicianRouter.put(
  '/clinicians/me/availability',
  requireAuth,
  requireVerifiedClinician,
  controller.setAvailability,
);
clinicianRouter.put(
  '/clinicians/me/slots',
  requireAuth,
  requireVerifiedClinician,
  controller.publishSlots,
);

// Any authenticated user may read a clinician's bookable slots — a patient
// choosing a time is the whole point of publishing them.
clinicianRouter.get('/clinicians/:clinician_id/slots', requireAuth, controller.listSlots);

clinicianRouter.get(
  '/clinicians',
  requireAuth,
  requireRole('platform_admin'),
  controller.list,
);
clinicianRouter.get('/clinicians/:clinician_id', requireAuth, controller.getOne);

clinicianRouter.post(
  '/clinicians/:clinician_id/verification',
  requireAuth,
  requireRole('platform_admin'),
  controller.decideVerification,
);
TS

# --- index -----------------------------------------------------------------
cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { clinicianRouter } from './routes/clinician.routes.js';

const service = createService({
  name: 'doctor',
  port: env.PORT,
  routers: [clinicianRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

# --- tests -----------------------------------------------------------------
cat > "$SVC/src/tests/clinician.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as clinicians from '../services/clinician.service.js';
import * as slots from '../services/slot.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const createdUsers: string[] = [];
const adminId = randomUUID();

after(async () => {
  for (const id of createdUsers) {
    await prisma.slot.deleteMany({ where: { clinician: { userId: id } } }).catch(() => undefined);
    await prisma.clinicianProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeClinician(status: 'pending' | 'verified' = 'pending') {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: 'clinician',
      status: status === 'verified' ? 'active' : 'pending_verification',
      fullName: 'Test Clinician',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus: status,
    },
  });
  return { user, profile };
}

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

describe('verification', () => {
  it('approving a licence also activates the account', async () => {
    const { user, profile } = await makeClinician('pending');
    const result = await clinicians.decideVerification(
      profile.id,
      adminId,
      'approve',
      undefined,
      meta,
    );

    assert.equal(result.verification_status, 'verified');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.status, 'active', 'approval is what makes the account usable');
  });

  it('rejecting records the reason and forces the clinician off duty', async () => {
    const { profile } = await makeClinician('verified');
    await prisma.clinicianProfile.update({
      where: { id: profile.id },
      data: { isAvailable: true },
    });

    const result = await clinicians.decideVerification(
      profile.id,
      adminId,
      'reject',
      'Licence could not be confirmed with the council',
      meta,
    );

    assert.equal(result.verification_status, 'rejected');
    assert.equal(result.is_available, false, 'a rejected licence must not stay on duty');
    assert.ok(result.rejection_reason);
  });

  it('refuses to approve twice', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () => clinicians.decideVerification(profile.id, adminId, 'approve', undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('availability', () => {
  it('refuses an unverified clinician', async () => {
    const { profile } = await makeClinician('pending');
    await assert.rejects(
      () => clinicians.setAvailability(profile.id, true, undefined, meta),
      (e: AppError) => e.code === 'CLINICIAN_NOT_VERIFIED',
    );
  });

  it('lets a verified clinician go on duty', async () => {
    const { profile } = await makeClinician('verified');
    const result = await clinicians.setAvailability(profile.id, true, undefined, meta);
    assert.equal(result.is_available, true);
  });
});

describe('slots', () => {
  it('publishes a clean set', async () => {
    const { profile } = await makeClinician('verified');
    const start = soon(60);
    const result = await slots.publishSlots(profile.id, {
      from: dayOf(start),
      to: dayOf(soon(1440)),
      slots: [
        { starts_at: start, duration_minutes: 30, modality: 'chat' },
        { starts_at: soon(120), duration_minutes: 30, modality: 'chat' },
      ],
    });
    assert.equal(result.published.length, 2);
  });

  it('rejects overlapping slots', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(60)),
          to: dayOf(soon(1440)),
          slots: [
            { starts_at: soon(60), duration_minutes: 30, modality: 'chat' },
            // Starts 15 minutes into the previous slot. Different start time,
            // same clinician, same moment — the unique constraint misses this.
            { starts_at: soon(75), duration_minutes: 30, modality: 'chat' },
          ],
        }),
      (e: AppError) => e.code === 'SLOT_UNAVAILABLE',
    );
  });

  it('rejects a slot in the past', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(-2880)),
          to: dayOf(soon(1440)),
          slots: [{ starts_at: soon(-60), duration_minutes: 30, modality: 'chat' }],
        }),
      (e: AppError) => e.code === 'SLOT_IN_PAST',
    );
  });

  it('keeps a booked slot when the calendar is republished', async () => {
    const { profile } = await makeClinician('verified');
    const bookedAt = new Date(Date.now() + 180 * 60_000);
    await prisma.slot.create({
      data: {
        clinicianId: profile.id,
        startsAt: bookedAt,
        durationMin: 30,
        modality: 'chat',
        isBooked: true,
      },
    });

    // Republishing an empty calendar must not silently cancel a patient's
    // appointment.
    const result = await slots.publishSlots(profile.id, {
      from: dayOf(bookedAt.toISOString()),
      to: dayOf(soon(2880)),
      slots: [],
    });

    assert.equal(result.retained.length, 1);
    assert.equal(result.retained[0]!.is_booked, true);
  });

  it('refuses an unverified clinician', async () => {
    const { profile } = await makeClinician('pending');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(60)),
          to: dayOf(soon(1440)),
          slots: [{ starts_at: soon(60), duration_minutes: 30, modality: 'chat' }],
        }),
      (e: AppError) => e.code === 'CLINICIAN_NOT_VERIFIED',
    );
  });
});
TS

# ===========================================================================
# Contract: describe the two endpoints that were missing
# ===========================================================================
if [ -f "$API" ]; then
  cp "$API" "$API.bak"
  node - "$API" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('  /clinicians:')) { console.log('  contract already patched'); process.exit(0); }

const anchor = '  /clinicians/{clinician_id}/verification:';
if (!s.includes(anchor)) { console.error('  contract anchor not found'); process.exit(1); }

s = s.replace(anchor, `  /clinicians:
    get:
      tags: [clinicians]
      summary: List clinicians, filtered
      description: |
        The queue an administrator works from. Approving a licence was already
        described, but there was no way to find the licences waiting for a
        decision, which made that endpoint unusable in practice.

        Admin only. Cursor paginated, because the pending list changes while it
        is being worked through.
      operationId: listClinicians
      parameters:
        - name: verification_status
          in: query
          schema:
            $ref: '#/components/schemas/VerificationStatus'
        - name: specialty
          in: query
          schema:
            $ref: '#/components/schemas/Specialty'
        - name: is_available
          in: query
          schema: { type: boolean }
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: Clinicians
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/ClinicianProfile'
                  meta:
                    $ref: '#/components/schemas/CursorMeta'
        '403': { $ref: '#/components/responses/Forbidden' }

  /clinicians/{clinician_id}:
    get:
      tags: [clinicians]
      summary: Get one clinician profile
      description: |
        Readable by an admin, or by the clinician themselves. Anyone else gets
        403 rather than 404, because the id is not a secret — what is protected
        is the record, not its existence.
      operationId: getClinician
      parameters:
        - $ref: '#/components/parameters/ClinicianId'
      responses:
        '200':
          description: Clinician profile
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ClinicianProfile'
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /clinicians/{clinician_id}/verification:`);

fs.writeFileSync(p, s);
console.log('  contract updated with 2 endpoints');
NODE
fi

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/doctor exec tsc --noEmit"
echo "  pnpm --filter @a-health/api lint"
echo "  pnpm --filter @a-health/doctor test"
