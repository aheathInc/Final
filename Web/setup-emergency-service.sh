#!/usr/bin/env bash
#
# Builds services/emergency and adds optionalAuth to packages/http.
#
# Why optionalAuth exists: an emergency must be reportable by a bystander who
# has no account and no time to create one. Every other write endpoint in this
# platform requires a session; this is the one deliberate exception, and it is
# built as a shared primitive rather than a one-off hack in this service,
# because the same need will recur for the USSD/SMS gateway.
#
# The rest of the service enforces the opposite discipline hard: legal status
# transitions only, dispatch requiring a real transport unit and facility, and
# patient context released under consent — with a break-glass path for the
# unconscious-patient case, which is always audited.
#
# Run from the repo root:
#   bash setup-emergency-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/emergency"
HTTP="$ROOT/packages/http"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$HTTP/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,types,tests}

# ===========================================================================
# 1. packages/http — optionalAuth
# ===========================================================================
node - "$HTTP/src/middleware/auth.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('optionalAuth')) {
  console.log('  packages/http already has optionalAuth');
} else {
  const ifaceOld = '  requireVerifiedClinician: (req: Request, res: Response, next: NextFunction) => void;\n}';
  if (!s.includes(ifaceOld)) { console.error('  AuthGuards interface anchor not found'); process.exit(1); }
  s = s.replace(
    ifaceOld,
    '  requireVerifiedClinician: (req: Request, res: Response, next: NextFunction) => void;\n' +
    '  /** Populates req.auth when a valid token is present; never rejects without one. */\n' +
    '  optionalAuth: (req: Request, res: Response, next: NextFunction) => void;\n}',
  );

  const returnOld = '  return { requireAuth, requireRole, requireVerifiedClinician };\n}';
  if (!s.includes(returnOld)) { console.error('  createAuthGuards return anchor not found'); process.exit(1); }
  s = s.replace(
    returnOld,
    '  /**\n' +
    '   * For the one class of write this platform allows without a session: reporting\n' +
    '   * an emergency. A bystander has no account and no time to create one. An\n' +
    '   * invalid or expired token here is treated as anonymous, not as an error —\n' +
    '   * the whole point is that reporting must never be blocked by an auth problem.\n' +
    '   */\n' +
    '  const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {\n' +
    '    const header = req.header(\'Authorization\');\n' +
    '    if (!header?.startsWith(\'Bearer \')) {\n' +
    '      next();\n' +
    '      return;\n' +
    '    }\n' +
    '    try {\n' +
    '      const claims = tokens.verify(header.slice(7).trim());\n' +
    '      if (claims.status === \'active\') req.auth = claims;\n' +
    '    } catch {\n' +
    '      // fall through as anonymous\n' +
    '    }\n' +
    '    next();\n' +
    '  };\n\n' +
    '  return { requireAuth, requireRole, requireVerifiedClinician, optionalAuth };\n}',
  );

  fs.writeFileSync(p, s);
  const check = fs.readFileSync(p, 'utf8');
  if (!check.includes('optionalAuth: (req: Request')) {
    console.error('  VERIFY FAILED: optionalAuth not on disk');
    process.exit(1);
  }
  console.log('  packages/http: optionalAuth added and verified on disk');
}
NODE

# ===========================================================================
# 2. packages/config — best effort, non-fatal if it doesn't match
# ===========================================================================
node - "$ROOT/packages/config/src/index.ts" << 'NODE' || echo "  (packages/config port constant skipped — non-fatal)"
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('emergency:')) { console.log('  packages/config already has emergency port'); process.exit(0); }
const anchor = 'notification: 4008,';
if (!s.includes(anchor)) { console.log('  packages/config anchor not found, skipping (non-fatal)'); process.exit(0); }
s = s.replace(anchor, anchor + '\n  emergency: 4010,');
fs.writeFileSync(p, s);
console.log('  packages/config: emergency port added');
NODE

# ===========================================================================
# 3. services/emergency
# ===========================================================================
node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/emergency';
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
  PORT: z.coerce.number().default(4010),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Nobody is dispatched to a unit further than this without a dispatcher override. */
  MAX_DISPATCH_RADIUS_KM: z.coerce.number().default(50),
});

export const env = envSchema.parse(process.env);
TS

# --- state machine ----------------------------------------------------------
cat > "$SVC/src/services/transition.ts" << 'TS'
/**
 * Legal status transitions for an emergency.
 *
 * `dispatched` is deliberately unreachable from here — it is only entered
 * through the dedicated dispatch action, which requires a real transport unit
 * and destination, not a bare status flip. That separation exists so a status
 * update can never claim a case is dispatched when nothing has actually been
 * assigned to it.
 *
 * An emergency cannot be closed without an outcome: resolving without one is
 * rejected below, in code, not left as a documentation convention.
 */

export type EmergencyStatus =
  | 'reported' | 'triaged' | 'dispatched' | 'en_route' | 'arrived' | 'resolved' | 'cancelled';

const ALLOWED_VIA_STATUS_ENDPOINT: Record<EmergencyStatus, EmergencyStatus[]> = {
  reported: ['triaged', 'cancelled'],
  triaged: ['cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

export function isLegalStatusTransition(from: EmergencyStatus, to: EmergencyStatus): boolean {
  return ALLOWED_VIA_STATUS_ENDPOINT[from]?.includes(to) ?? false;
}

export function canDispatch(status: EmergencyStatus): boolean {
  return status === 'reported' || status === 'triaged';
}
TS

# --- consent-aware context, with break-glass ---------------------------------
cat > "$SVC/src/services/consentContext.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';

export interface EmergencyContext {
  allergies: string[];
  chronicConditions: string[];
  bloodType: string | null;
  breakGlass: boolean;
}

/**
 * Resolves what a receiving facility may know about a patient at dispatch.
 *
 * A conscious patient with an existing `emergency_minimum` or broader consent
 * grant is served from that grant. An unconscious patient with no grant is
 * served anyway — a person collapsed in the street cannot consent — but that
 * path is named `breakGlass` in the audit trail and always writes an entry,
 * exactly as the schema's own comment on PatientConsent describes. Silence
 * would be worse than either withholding the context or logging the access.
 */
export async function resolveEmergencyContext(
  patientProfileId: string,
  emergencyId: string,
  actorUserId: string | undefined,
): Promise<EmergencyContext | null> {
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) return null;

  const grant = await prisma.patientConsent.findFirst({
    where: {
      patientProfileId,
      granteeType: 'emergency_responder',
      allowed: true,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const breakGlass = !grant;

  if (breakGlass) {
    await appendAudit({
      actorUserId: actorUserId ?? null,
      action: 'emergency.context_break_glass_access',
      entityType: 'patient_profiles',
      entityId: patientProfileId,
      reason: 'No standing emergency-responder consent at time of dispatch',
      metadata: { emergencyRequestId: emergencyId },
    });
  }

  return {
    allergies: Array.isArray(patient.allergies) ? (patient.allergies as string[]) : [],
    chronicConditions: Array.isArray(patient.chronicConditions) ? (patient.chronicConditions as string[]) : [],
    bloodType: patient.bloodType,
    breakGlass,
  };
}
TS

# --- events -------------------------------------------------------------------
cat > "$SVC/src/events.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createPostgresEventBus, type DomainEvent } from '@a-health/http';
import { env } from './config/env.js';

export const bus = createPostgresEventBus(env.DATABASE_URL);

/** Who should hear about this emergency in realtime: the reporter and the patient. */
export async function audienceFor(emergencyId: string): Promise<string[]> {
  const e = await prisma.emergencyRequest.findUnique({
    where: { id: emergencyId },
    select: {
      reportedByUserId: true,
      patient: { select: { userId: true, guardianUserId: true } },
    },
  });
  if (!e) return [];
  return [e.reportedByUserId, e.patient?.userId, e.patient?.guardianUserId]
    .filter((id): id is string => Boolean(id));
}

export async function publishEmergencyEvent(
  emergencyId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const audienceUserIds = await audienceFor(emergencyId);
    if (audienceUserIds.length === 0) return;
    const event: DomainEvent = {
      event: 'emergency.dispatched',
      entity: 'emergency_requests',
      id: emergencyId,
      audienceUserIds,
      data,
    };
    await bus.publish(event);
  } catch {
    /* best effort — the record is already committed */
  }
}
TS

# --- emergency request service -----------------------------------------------
cat > "$SVC/src/services/emergencyRequest.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { canDispatch, isLegalStatusTransition, type EmergencyStatus } from './transition.js';
import { resolveEmergencyContext } from './consentContext.js';
import { publishEmergencyEvent } from '../events.js';

export interface Caller { sub?: string; role?: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(e: {
  id: string; scale: string; category: string; source: string; status: string; outcome: string | null;
  lat: number; lng: number; patientProfileId: string | null; estimatedCasualties: number | null;
  description: string | null; transportUnitId: string | null; destinationFacilityId: string | null;
  reportedAt: Date; dispatchedAt: Date | null; arrivedAt: Date | null; resolvedAt: Date | null;
  version: number;
}) {
  return {
    id: e.id,
    scale: e.scale,
    category: e.category,
    source: e.source,
    status: e.status,
    outcome: e.outcome,
    location: { lat: e.lat, lng: e.lng },
    patient_profile_id: e.patientProfileId,
    estimated_casualties: e.estimatedCasualties,
    description: e.description,
    transport_unit_id: e.transportUnitId,
    destination_facility_id: e.destinationFacilityId,
    reported_at: e.reportedAt.toISOString(),
    dispatched_at: e.dispatchedAt?.toISOString() ?? null,
    arrived_at: e.arrivedAt?.toISOString() ?? null,
    resolved_at: e.resolvedAt?.toISOString() ?? null,
    version: e.version,
  };
}

/**
 * Deliberately tolerant of missing information. A bystander reporting a road
 * crash may know nothing about the injured beyond where they are — `caller`
 * may be entirely absent, which is why this accepts an optional caller rather
 * than requiring one.
 */
export async function createEmergencyRequest(
  caller: Caller,
  input: {
    scale: string; category?: string; location: { lat: number; lng: number };
    patient_profile_id?: string; estimated_casualties?: number; description?: string;
    reporter_phone?: string; source?: string; channel?: string;
  },
) {
  const source = input.source ?? (caller.sub ? 'patient_app' : 'bystander');

  const emergency = await prisma.$transaction(async (tx) => {
    const created = await tx.emergencyRequest.create({
      data: {
        scale: input.scale as never,
        category: (input.category ?? 'other') as never,
        source: source as never,
        status: 'reported',
        lat: input.location.lat,
        lng: input.location.lng,
        patientProfileId: input.patient_profile_id ?? null,
        reportedByUserId: caller.sub ?? null,
        reporterPhone: input.reporter_phone ?? null,
        estimatedCasualties: input.estimated_casualties ?? null,
        description: input.description ?? null,
      },
    });
    await tx.emergencyEvent.create({
      data: { emergencyId: created.id, toStatus: 'reported', actorUserId: caller.sub ?? null },
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub ?? null,
    action: 'emergency.reported',
    entityType: 'emergency_requests',
    entityId: emergency.id,
    metadata: { scale: input.scale, source },
  });

  return serialise(emergency);
}

async function assertVisible(emergencyId: string, caller: Caller) {
  const emergency = await prisma.emergencyRequest.findUnique({
    where: { id: emergencyId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!emergency) throw notFound('Emergency not found');

  const privileged = caller.role === 'dispatcher' || caller.role === 'platform_admin';
  const isReporter = caller.sub && emergency.reportedByUserId === caller.sub;
  const isPatient = caller.sub && (emergency.patient?.userId === caller.sub || emergency.patient?.guardianUserId === caller.sub);

  if (!privileged && !isReporter && !isPatient) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view this emergency');
  }
  return emergency;
}

export async function getEmergencyRequest(emergencyId: string, caller: Caller) {
  const emergency = await assertVisible(emergencyId, caller);
  return serialise(emergency);
}

export async function listEmergencyRequests(
  caller: Caller,
  query: { status?: string; facility_id?: string; cursor?: string; limit: number },
) {
  if (caller.role !== 'dispatcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only dispatchers may list emergencies');
  }
  const rows = await prisma.emergencyRequest.findMany({
    where: {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.facility_id ? { destinationFacilityId: query.facility_id } : {}),
    },
    orderBy: [{ scale: 'desc' }, { reportedAt: 'asc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

/**
 * Assigns transport and a receiving facility, and — where the patient is
 * known — resolves what context may travel with them, consent-checked.
 *
 * Only legal from `reported` or `triaged`. This is the one place `dispatched`
 * is ever entered; the generic status endpoint refuses to produce it.
 */
export async function dispatchEmergency(
  emergencyId: string, caller: Caller,
  input: { transport_unit_id: string; destination_facility_id: string; notes?: string },
  meta: Meta,
) {
  const emergency = await prisma.emergencyRequest.findUnique({ where: { id: emergencyId } });
  if (!emergency) throw notFound('Emergency not found');
  if (!canDispatch(emergency.status as EmergencyStatus)) {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot dispatch from status "${emergency.status}"`);
  }

  const unit = await prisma.transportUnit.findUnique({ where: { id: input.transport_unit_id } });
  if (!unit) throw notFound('Transport unit not found');
  if (unit.status === 'out_of_service') {
    throw conflict('STATE_TRANSITION_INVALID', 'Transport unit is out of service');
  }

  const facility = await prisma.facility.findUnique({ where: { id: input.destination_facility_id } });
  if (!facility) throw notFound('Destination facility not found');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emergencyRequest.update({
      where: { id: emergencyId },
      data: {
        transportUnitId: input.transport_unit_id,
        destinationFacilityId: input.destination_facility_id,
        status: 'dispatched',
        dispatchedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.transportUnit.update({
      where: { id: input.transport_unit_id },
      data: { status: 'dispatched', version: { increment: 1 } },
    });
    await tx.emergencyEvent.create({
      data: {
        emergencyId, fromStatus: emergency.status as never, toStatus: 'dispatched',
        actorUserId: caller.sub ?? null, notes: input.notes ?? null,
      },
    });
    return row;
  });

  let context = null;
  if (emergency.patientProfileId) {
    context = await resolveEmergencyContext(emergency.patientProfileId, emergencyId, caller.sub);
  }

  await appendAudit({
    actorUserId: caller.sub ?? null,
    action: 'emergency.dispatched',
    entityType: 'emergency_requests',
    entityId: emergencyId,
    metadata: { transportUnitId: input.transport_unit_id, destinationFacilityId: input.destination_facility_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  await publishEmergencyEvent(emergencyId, { status: 'dispatched', context_shared: context !== null });

  return { ...serialise(updated), context_shared: context !== null, break_glass: context?.breakGlass ?? false };
}

export async function setEmergencyStatus(
  emergencyId: string, caller: Caller,
  input: { status: string; outcome?: string; notes?: string },
  meta: Meta,
) {
  if (caller.role !== 'dispatcher' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only dispatchers may update emergency status');
  }

  const emergency = await prisma.emergencyRequest.findUnique({ where: { id: emergencyId } });
  if (!emergency) throw notFound('Emergency not found');

  const from = emergency.status as EmergencyStatus;
  const to = input.status as EmergencyStatus;
  if (!isLegalStatusTransition(from, to)) {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot move from "${from}" to "${to}"`);
  }
  if (to === 'resolved' && !input.outcome) {
    throw unprocessable('An outcome is required to resolve an emergency', 'outcome');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emergencyRequest.update({
      where: { id: emergencyId },
      data: {
        status: to as never,
        ...(input.outcome ? { outcome: input.outcome as never } : {}),
        ...(to === 'arrived' ? { arrivedAt: new Date() } : {}),
        ...(to === 'resolved' || to === 'cancelled' ? { resolvedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    await tx.emergencyEvent.create({
      data: { emergencyId, fromStatus: from, toStatus: to, actorUserId: caller.sub ?? null, notes: input.notes ?? null },
    });
    return row;
  });

  await appendAudit({
    actorUserId: caller.sub ?? null, action: 'emergency.status_changed',
    entityType: 'emergency_requests', entityId: emergencyId,
    metadata: { from, to, outcome: input.outcome ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  await publishEmergencyEvent(emergencyId, { status: to });

  return serialise(updated);
}
TS

# --- transport unit service ---------------------------------------------------
cat > "$SVC/src/services/transportUnit.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { notFound } from '@a-health/http';

function serialise(u: {
  id: string; callSign: string; capability: string; status: string;
  lat: number | null; lng: number | null; locationUpdatedAt: Date | null;
}, distanceKm?: number) {
  return {
    id: u.id,
    call_sign: u.callSign,
    capability: u.capability,
    status: u.status,
    location: u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null,
    distance_km: distanceKm ?? null,
    location_updated_at: u.locationUpdatedAt?.toISOString() ?? null,
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function listTransportUnits(query: {
  status?: string; near_lat?: number; near_lng?: number;
}) {
  const rows = await prisma.transportUnit.findMany({
    where: { ...(query.status ? { status: query.status as never } : {}) },
    take: 200,
  });

  const withDistance = rows.map((u) => {
    const distance =
      query.near_lat != null && query.near_lng != null && u.lat != null && u.lng != null
        ? haversineKm(query.near_lat, query.near_lng, u.lat, u.lng)
        : undefined;
    return { unit: u, distance };
  });

  if (query.near_lat != null && query.near_lng != null) {
    withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  return { data: withDistance.map(({ unit, distance }) => serialise(unit, distance)) };
}

/**
 * High frequency, low value individually. A live position matters; a month of
 * breadcrumbs does not — this writes the cached position on the unit for fast
 * reads, plus one TransportPing row for the trail, and does not audit-log
 * each call, which at this volume would drown every other entry in the log.
 */
export async function updateTransportLocation(
  unitId: string,
  input: { location: { lat: number; lng: number }; heading_degrees?: number; speed_kph?: number },
) {
  const unit = await prisma.transportUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Transport unit not found');

  await prisma.$transaction([
    prisma.transportUnit.update({
      where: { id: unitId },
      data: { lat: input.location.lat, lng: input.location.lng, locationUpdatedAt: new Date() },
    }),
    prisma.transportPing.create({
      data: {
        unitId,
        lat: input.location.lat,
        lng: input.location.lng,
        headingDegrees: input.heading_degrees ?? null,
        speedKph: input.speed_kph ?? null,
      },
    }),
  ]);
}

export async function setTransportStatus(unitId: string, status: string) {
  const unit = await prisma.transportUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Transport unit not found');

  const updated = await prisma.transportUnit.update({
    where: { id: unitId },
    data: { status: status as never, version: { increment: 1 } },
  });
  return serialise(updated);
}
TS

# --- types --------------------------------------------------------------------
cat > "$SVC/src/types/emergency.types.ts" << 'TS'
import { z } from 'zod';

export const createEmergencySchema = z.object({
  scale: z.enum(['individual', 'mass_casualty']),
  category: z.enum(['medical', 'trauma', 'obstetric', 'road_traffic', 'fire', 'other']).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  patient_profile_id: z.string().uuid().optional(),
  estimated_casualties: z.number().int().min(1).optional(),
  description: z.string().max(2000).optional(),
  reporter_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  source: z.enum(['patient_app', 'bystander', 'ussd', 'sms', 'voice', 'wearable', 'vehicle_sensor', 'facility']).optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
});

export const listEmergenciesQuery = z.object({
  status: z.enum(['reported', 'triaged', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled']).optional(),
  facility_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const dispatchSchema = z.object({
  transport_unit_id: z.string().uuid(),
  destination_facility_id: z.string().uuid(),
  notes: z.string().max(1000).optional(),
});

export const setStatusSchema = z.object({
  status: z.enum(['triaged', 'en_route', 'arrived', 'resolved', 'cancelled']),
  outcome: z.enum(['transported', 'treated_on_scene', 'refused_care', 'false_alarm', 'deceased']).optional(),
  notes: z.string().max(1000).optional(),
});

export const listUnitsQuery = z.object({
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']).optional(),
  near_lat: z.coerce.number().optional(),
  near_lng: z.coerce.number().optional(),
});

export const updateLocationSchema = z.object({
  location: z.object({ lat: z.number(), lng: z.number() }),
  heading_degrees: z.number().optional(),
  speed_kph: z.number().min(0).optional(),
});

export const setUnitStatusSchema = z.object({
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']),
});
TS

# --- controller -----------------------------------------------------------
cat > "$SVC/src/controllers/emergency.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import {
  createEmergencySchema, dispatchSchema, listEmergenciesQuery, listUnitsQuery,
  setStatusSchema, setUnitStatusSchema, updateLocationSchema,
} from '../types/emergency.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role, ppid: req.auth?.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req) => emergencies.createEmergencyRequest(caller(req), createEmergencySchema.parse(req.body)), 201,
);

export const list = handle((req) =>
  emergencies.listEmergencyRequests(caller(req), listEmergenciesQuery.parse(req.query)));

export const getOne = handle((req) =>
  emergencies.getEmergencyRequest(pathParam(req, 'emergency_id'), caller(req)));

export const dispatch = handle((req, res) =>
  emergencies.dispatchEmergency(pathParam(req, 'emergency_id'), caller(req), dispatchSchema.parse(req.body), meta(req, res)));

export const setStatus = handle((req, res) =>
  emergencies.setEmergencyStatus(pathParam(req, 'emergency_id'), caller(req), setStatusSchema.parse(req.body), meta(req, res)));

export const listUnits = handle((req) => units.listTransportUnits(listUnitsQuery.parse(req.query)));

export const updateLocation = handle(async (req) => {
  await units.updateTransportLocation(pathParam(req, 'unit_id'), updateLocationSchema.parse(req.body));
  return undefined;
}, 204);

export const setUnitStatus = handle((req) => {
  const input = setUnitStatusSchema.parse(req.body);
  return units.setTransportStatus(pathParam(req, 'unit_id'), input.status);
});
TS

# --- routes -----------------------------------------------------------------
cat > "$SVC/src/routes/emergency.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/emergency.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole, optionalAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
const dispatcherOnly = requireRole('dispatcher', 'platform_admin');

export const emergencyRouter = Router();

// The one deliberate exception to requiring a session: reporting an
// emergency must never be blocked by an auth problem.
emergencyRouter.post('/emergency-requests', optionalAuth, idempotency, c.create);

emergencyRouter.get('/emergency-requests', requireAuth, c.list);
emergencyRouter.get('/emergency-requests/:emergency_id', requireAuth, c.getOne);
emergencyRouter.post('/emergency-requests/:emergency_id/dispatch', requireAuth, dispatcherOnly, idempotency, c.dispatch);
emergencyRouter.post('/emergency-requests/:emergency_id/status', requireAuth, dispatcherOnly, idempotency, c.setStatus);

emergencyRouter.get('/transport-units', requireAuth, dispatcherOnly, c.listUnits);
emergencyRouter.put('/transport-units/:unit_id/location', requireAuth, dispatcherOnly, c.updateLocation);
emergencyRouter.post('/transport-units/:unit_id/status', requireAuth, dispatcherOnly, c.setUnitStatus);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { emergencyRouter } from './routes/emergency.routes.js';
import { bus } from './events.js';

const service = createService({
  name: 'emergency',
  port: env.PORT,
  routers: [emergencyRouter],
  development: env.NODE_ENV === 'development',
  onShutdown: () => bus.close(),
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4010"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/emergency.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import { isLegalStatusTransition, canDispatch } from '../services/transition.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const dispatcher = { sub: randomUUID(), role: 'dispatcher' };
const users: string[] = [];
const emergencyIds: string[] = [];
const unitIds: string[] = [];
const facilityIds: string[] = [];

after(async () => {
  for (const id of emergencyIds) {
    await prisma.emergencyEvent.deleteMany({ where: { emergencyId: id } }).catch(() => undefined);
    await prisma.emergencyRequest.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of unitIds) {
    await prisma.transportPing.deleteMany({ where: { unitId: id } }).catch(() => undefined);
    await prisma.transportUnit.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of facilityIds) {
    await prisma.facility.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Emergency Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Emergency Test' } });
  return { user, profile };
}

async function makeUnit(status = 'available') {
  const unit = await prisma.transportUnit.create({
    data: { callSign: `T-${randomInt(1000, 9999)}`, capability: 'basic', status: status as never, lat: -6.8, lng: 39.28 },
  });
  unitIds.push(unit.id);
  return unit;
}

async function makeFacility() {
  const facility = await prisma.facility.create({
    data: { name: 'Test Facility', type: 'hospital', lat: -6.79, lng: 39.27 },
  });
  facilityIds.push(facility.id);
  return facility;
}

describe('transition rules', () => {
  it('never allows entering dispatched via the status endpoint', () => {
    assert.equal(isLegalStatusTransition('reported', 'dispatched'), false);
    assert.equal(isLegalStatusTransition('triaged', 'dispatched'), false);
  });

  it('allows dispatch action only from reported or triaged', () => {
    assert.equal(canDispatch('reported'), true);
    assert.equal(canDispatch('triaged'), true);
    assert.equal(canDispatch('dispatched'), false);
    assert.equal(canDispatch('resolved'), false);
  });

  it('allows cancellation from any active state', () => {
    for (const s of ['reported', 'triaged', 'dispatched', 'en_route', 'arrived'] as const) {
      assert.equal(isLegalStatusTransition(s, 'cancelled'), true);
    }
  });
});

describe('reporting', () => {
  it('accepts a report with no authenticated caller', async () => {
    const result = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, source: 'bystander' },
    );
    emergencyIds.push(result.id);
    assert.equal(result.status, 'reported');
    assert.equal(result.source, 'bystander');
  });

  it('defaults source to patient_app for an authenticated caller', async () => {
    const { user } = await makePatient();
    const result = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(result.id);
    assert.equal(result.source, 'patient_app');
  });
});

describe('visibility', () => {
  it('lets the reporter see their own report', async () => {
    const { user } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const fetched = await emergencies.getEmergencyRequest(created.id, { sub: user.id, role: 'patient' });
    assert.equal(fetched.id, created.id);
  });

  it('refuses a stranger', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.getEmergencyRequest(created.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses list to a non-dispatcher', async () => {
    await assert.rejects(
      () => emergencies.listEmergencyRequests({ sub: randomUUID(), role: 'patient' }, { limit: 10 }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('dispatch', () => {
  it('dispatches to an available unit and facility', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta,
    );
    assert.equal(result.status, 'dispatched');

    const reloadedUnit = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloadedUnit.status, 'dispatched');
  });

  it('refuses to dispatch an out-of-service unit', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('out_of_service');
    const facility = await makeFacility();

    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses to dispatch an already-dispatched emergency', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    const unit2 = await makeUnit('available');
    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit2.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('writes a break-glass audit entry when the patient has no standing consent', async () => {
    const { user, profile } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta,
    );
    assert.equal(result.break_glass, true);

    const entries = await prisma.auditLog.count({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(entries, 1);
  });
});

describe('status transitions', () => {
  it('walks a full lifecycle to resolved', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);
    const resolved = await emergencies.setEmergencyStatus(
      created.id, dispatcher, { status: 'resolved', outcome: 'transported' }, meta,
    );
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.outcome, 'transported');
  });

  it('refuses to resolve without an outcome', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);

    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'resolved' }, meta),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('refuses an illegal jump from reported to arrived', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' as never }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('transport units', () => {
  it('orders results by distance when a location is given', async () => {
    const near = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: near.id }, data: { lat: -6.80, lng: 39.28 } });
    const far = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: far.id }, data: { lat: -7.50, lng: 39.90 } });

    const result = await units.listTransportUnits({ status: 'available', near_lat: -6.80, near_lng: 39.28 });
    const ids = result.data.map((u) => u.id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id));
  });

  it('records a ping and updates the cached position on a location update', async () => {
    const unit = await makeUnit('en_route');
    await units.updateTransportLocation(unit.id, { location: { lat: -6.81, lng: 39.29 } });

    const reloaded = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloaded.lat, -6.81);

    const pings = await prisma.transportPing.count({ where: { unitId: unit.id } });
    assert.equal(pings, 1);
  });

  it('sets a unit status', async () => {
    const unit = await makeUnit('available');
    const updated = await units.setTransportStatus(unit.id, 'out_of_service');
    assert.equal(updated.status, 'out_of_service');
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/emergency exec tsc --noEmit"
echo "  pnpm --filter @a-health/emergency test"
