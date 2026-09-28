#!/usr/bin/env bash
#
# Builds services/devices — wearables and vehicle sensors. A device credential
# authenticates telemetry and alerts, never a user session; a fall or a
# collision is real regardless of whether a phone happens to be logged in
# nearby. An alert that warrants it opens a REAL emergency through
# services/emergency's own endpoint — reusing the exact bystander-reporting
# path already built for this, since a sensor with no human present is
# structurally the same situation.
#
# Run from the repo root:
#   bash setup-devices-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/devices"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in DUPLICATE_RESOURCE NOT_FOUND FORBIDDEN UNAUTHENTICATED NOT_RESOURCE_OWNER; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

mkdir -p "$SVC/src"/{config,routes,controllers,services,middleware,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/devices';
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
  PORT: z.coerce.number().default(4023),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  EMERGENCY_SERVICE_URL: z.string().default('http://localhost:4010'),
});

export const env = envSchema.parse(process.env);
TS

# --- device credential auth: a separate guard, not requireAuth --------------
cat > "$SVC/src/middleware/deviceCredential.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@a-health/database';
import { sha256, unauthenticated } from '@a-health/http';
import { pathParam } from '@a-health/http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: { id: string; patientProfileId: string | null };
    }
  }
}

/**
 * Telemetry and alerts are authenticated by the device's own credential, not
 * a user session — the contract is explicit about this, and it is the
 * correct choice: a fall is real whether or not a phone happens to be
 * logged in nearby. The credential is compared as a hash, the same pattern
 * as a pharmacy dispense code — shown once at registration, never stored or
 * transmitted in the clear again.
 */
export async function requireDeviceCredential(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const credential = req.header('X-Device-Credential');
  if (!credential) {
    next(unauthenticated('UNAUTHENTICATED', 'Missing device credential'));
    return;
  }
  const deviceId = pathParam(req, 'device_id');
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== 'active' || device.credentialHash !== sha256(credential)) {
    next(unauthenticated('UNAUTHENTICATED', 'Device credential is not valid'));
    return;
  }
  req.device = { id: device.id, patientProfileId: device.patientProfileId };
  next();
}
TS

# --- device registration/management -----------------------------------------
cat > "$SVC/src/services/device.service.ts" << 'TS'
import { randomBytes } from 'node:crypto';
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, sha256 } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(d: {
  id: string; deviceType: string; serialNumber: string; patientProfileId: string | null;
  vehicleRegistration: string | null; label: string | null; status: string;
  lastSeenAt: Date | null; batteryPercent: number | null; version: number;
}) {
  return {
    id: d.id,
    device_type: d.deviceType,
    serial_number: d.serialNumber,
    patient_profile_id: d.patientProfileId,
    vehicle_registration: d.vehicleRegistration,
    label: d.label,
    status: d.status,
    last_seen_at: d.lastSeenAt?.toISOString() ?? null,
    battery_percent: d.batteryPercent,
    version: d.version,
  };
}

/**
 * The device credential is generated here, shown once in the response, and
 * never retrievable again — a secret that can raise an emergency is not one
 * worth keeping recoverable. Losing it means re-registering, which is the
 * correct trade.
 */
export async function registerDevice(
  caller: Caller,
  input: {
    device_type: string; serial_number: string; patient_profile_id?: string;
    vehicle_registration?: string; label?: string;
  },
  meta: Meta,
) {
  const isVehicle = input.device_type === 'vehicle_sensor';
  const patientProfileId = isVehicle ? null : (input.patient_profile_id ?? caller.ppid ?? null);
  if (!isVehicle && !patientProfileId) {
    throw forbidden('ROLE_NOT_PERMITTED', 'A patient-worn device needs a patient profile');
  }

  const existing = await prisma.device.findUnique({ where: { serialNumber: input.serial_number } });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'A device with this serial number is already registered');

  const credential = randomBytes(32).toString('hex');

  const device = await prisma.device.create({
    data: {
      deviceType: input.device_type as never,
      serialNumber: input.serial_number,
      patientProfileId,
      vehicleRegistration: isVehicle ? (input.vehicle_registration ?? null) : null,
      label: input.label ?? null,
      credentialHash: sha256(credential),
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'device.registered',
    entityType: 'devices', entityId: device.id,
    metadata: { deviceType: input.device_type },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return { ...serialise(device), device_credential: credential };
}

export async function listDevices(caller: Caller) {
  const where = caller.role === 'platform_admin' ? {} : { patientProfileId: caller.ppid ?? '__none__' };
  const rows = await prisma.device.findMany({ where, orderBy: { createdAt: 'desc' } });
  return { data: rows.map(serialise) };
}

/** Idempotent: revoking an already-revoked device is not an error — the end state is what the caller wants, and they may not know which state it was already in. */
export async function revokeDevice(deviceId: string, caller: Caller, meta: Meta) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound('Device not found');

  const owns = caller.role === 'platform_admin' || (device.patientProfileId && device.patientProfileId === caller.ppid);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot revoke this device');

  if (device.status !== 'revoked') {
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'revoked', revokedAt: new Date(), version: { increment: 1 } },
    });
    await appendAudit({
      actorUserId: caller.sub, action: 'device.revoked',
      entityType: 'devices', entityId: deviceId,
      ipAddress: meta.ip, requestId: meta.requestId,
    });
  }
}
TS

# --- telemetry + alerts --------------------------------------------------
cat > "$SVC/src/services/telemetry.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('devices.telemetry');

/**
 * Batched because a watch on a patchy network buffers for hours. Each
 * reading carries its own device-clock timestamp — arrival order at this
 * endpoint means nothing, and is never used to order the stored rows.
 */
export async function ingestTelemetry(
  deviceId: string,
  readings: { metric: string; value: number; unit?: string; recorded_at: string }[],
) {
  await prisma.$transaction([
    prisma.deviceTelemetry.createMany({
      data: readings.map((r) => ({
        deviceId, metric: r.metric as never, value: r.value,
        unit: r.unit ?? null, recordedAt: new Date(r.recorded_at),
      })),
    }),
    prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }),
  ]);
}

const RECIPIENT_RESOLVERS: Record<string, (patientProfileId: string) => Promise<{ type: string; id: string | null }[]>> = {
  async patient(patientProfileId) {
    const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!patient) return [];
    const ids = [patient.userId, patient.guardianUserId].filter((x): x is string => Boolean(x));
    return ids.map((id) => ({ type: 'patient', id }));
  },
  async treating_clinician(patientProfileId) {
    const thread = await prisma.careThread.findFirst({
      where: { patientProfileId, status: 'open' },
      orderBy: { updatedAt: 'desc' },
      include: { consultations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const clinicianId = thread?.consultations[0]?.assignedClinicianId ?? thread?.primaryClinicianId ?? null;
    return clinicianId ? [{ type: 'treating_clinician', id: clinicianId }] : [];
  },
  async family_doctor(patientProfileId) {
    const family = await prisma.familyMember.findFirst({
      where: { patientProfileId },
      include: { family: { include: { assignments: true } } },
    });
    const gp = family?.family.assignments[0]?.gpClinicianId ?? null;
    return gp ? [{ type: 'family_doctor', id: gp }] : [];
  },
};

/**
 * Fans out to whichever recipients can actually be resolved from real data
 * — the patient themselves, their treating clinician, their family doctor —
 * and opens a REAL emergency through services/emergency's own endpoint,
 * reusing the bystander-reporting path already built there rather than a
 * second implementation. A device with nobody nearby to speak for the
 * patient is structurally the same situation a bystander call already
 * handles, down to the optional-auth requirement.
 *
 * Recipient rows are written as delivered:false — actual dispatch through
 * the notification service is a follow-up wiring step, noted here rather
 * than silently assumed.
 */
export async function raiseDeviceAlert(
  deviceId: string,
  input: { alert_type: string; detected_at: string; location?: { lat: number; lng: number }; confidence?: number; readings?: unknown[] },
) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return null;

  const alert = await prisma.deviceAlert.create({
    data: {
      deviceId,
      alertType: input.alert_type as never,
      confidence: input.confidence ?? null,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      triggerReadings: (input.readings ?? []) as never,
      detectedAt: new Date(input.detected_at),
    },
  });

  if (device.patientProfileId) {
    for (const [type, resolver] of Object.entries(RECIPIENT_RESOLVERS)) {
      const recipients = await resolver(device.patientProfileId);
      for (const r of recipients) {
        await prisma.deviceAlertRecipient.create({
          data: { alertId: alert.id, recipientType: r.type as never, recipientId: r.id, channel: 'app' as never },
        });
      }
    }
  }

  try {
    const source = device.deviceType === 'vehicle_sensor' ? 'vehicle_sensor' : 'wearable';
    const response = await fetch(`${env.EMERGENCY_SERVICE_URL}/emergency-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `alert-${alert.id}` },
      body: JSON.stringify({
        scale: 'individual',
        category: input.alert_type === 'collision_detected' ? 'road_traffic' : 'medical',
        location: input.location ?? { lat: 0, lng: 0 },
        patient_profile_id: device.patientProfileId ?? undefined,
        source,
        description: `Device alert: ${input.alert_type}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = (await response.json()) as { id: string };
      await prisma.deviceAlert.update({ where: { id: alert.id }, data: { emergencyRequestId: body.id } });
    }
  } catch (err) {
    logger.error('failed to open emergency from device alert', { alertId: alert.id, err: String(err) });
  }

  return alert;
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/types/devices.types.ts" << 'TS'
import { z } from 'zod';

export const registerDeviceSchema = z.object({
  device_type: z.enum(['wearable_watch', 'vehicle_sensor', 'bp_monitor', 'glucometer', 'pulse_oximeter']),
  serial_number: z.string().min(1).max(100),
  patient_profile_id: z.string().uuid().optional(),
  vehicle_registration: z.string().max(40).optional(),
  label: z.string().max(100).optional(),
});

const geoPoint = z.object({ lat: z.number(), lng: z.number(), accuracy_metres: z.number().optional() });

export const telemetryReadingSchema = z.object({
  metric: z.enum(['heart_rate', 'spo2', 'systolic', 'diastolic', 'glucose', 'temperature', 'steps', 'motion', 'impact_g']),
  value: z.number(),
  unit: z.string().nullable().optional(),
  recorded_at: z.string().datetime(),
});

export const ingestTelemetrySchema = z.object({
  readings: z.array(telemetryReadingSchema).max(500).min(1),
});

export const raiseAlertSchema = z.object({
  alert_type: z.enum(['fall_detected', 'collision_detected', 'heart_rate_abnormal', 'spo2_low', 'no_motion', 'manual_trigger']),
  detected_at: z.string().datetime(),
  location: geoPoint.optional(),
  confidence: z.number().min(0).max(1).optional(),
  readings: z.array(telemetryReadingSchema).optional(),
});
TS

cat > "$SVC/src/controllers/devices.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as devices from '../services/device.service.js';
import { ingestTelemetry, raiseDeviceAlert } from '../services/telemetry.service.js';
import { ingestTelemetrySchema, raiseAlertSchema, registerDeviceSchema } from '../types/devices.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const register = handle(
  (req, res) => devices.registerDevice(caller(req), registerDeviceSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => devices.listDevices(caller(req)));

export const revoke = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await devices.revokeDevice(pathParam(req, 'device_id'), caller(req), meta(req, res));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const telemetry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ingestTelemetrySchema.parse(req.body);
    await ingestTelemetry(pathParam(req, 'device_id'), input.readings);
    res.status(202).end();
  } catch (err) {
    next(err);
  }
};

export const alert = handle(async (req) => {
  const input = raiseAlertSchema.parse(req.body);
  const result = await raiseDeviceAlert(pathParam(req, 'device_id'), input);
  return result ?? {};
}, 201);
TS

cat > "$SVC/src/routes/devices.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { requireDeviceCredential } from '../middleware/deviceCredential.js';
import * as c from '../controllers/devices.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const devicesRouter = Router();

devicesRouter.post('/devices', requireAuth, idempotency, c.register);
devicesRouter.get('/devices', requireAuth, c.list);
devicesRouter.post('/devices/:device_id/revoke', requireAuth, c.revoke);

// Device-credential authenticated, not a user session.
devicesRouter.post('/devices/:device_id/telemetry', requireDeviceCredential, c.telemetry);
devicesRouter.post('/devices/:device_id/alerts', requireDeviceCredential, idempotency, c.alert);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { devicesRouter } from './routes/devices.routes.js';

const service = createService({
  name: 'devices',
  port: env.PORT,
  routers: [devicesRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4023"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "EMERGENCY_SERVICE_URL=http://localhost:4010"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/devices.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { sha256 } from '@a-health/http';
import * as devices from '../services/device.service.js';
import { ingestTelemetry, raiseDeviceAlert } from '../services/telemetry.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const deviceIds: string[] = [];

after(async () => {
  for (const id of deviceIds) {
    await prisma.deviceAlertRecipient.deleteMany({ where: { alert: { deviceId: id } } }).catch(() => undefined);
    await prisma.deviceAlert.deleteMany({ where: { deviceId: id } }).catch(() => undefined);
    await prisma.deviceTelemetry.deleteMany({ where: { deviceId: id } }).catch(() => undefined);
    await prisma.device.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Device Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Device Test' } });
  return { user, profile };
}

describe('registration', () => {
  it('registers a wearable and returns the credential once', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice(
      { sub: user.id, role: 'patient', ppid: profile.id },
      { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta,
    );
    deviceIds.push(result.id);
    assert.ok(result.device_credential);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.credentialHash, sha256(result.device_credential));
  });

  it('refuses a duplicate serial number', async () => {
    const { user, profile } = await makePatient();
    const serial = `SN-${randomUUID()}`;
    const first = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: serial }, meta);
    deviceIds.push(first.id);

    await assert.rejects(
      () => devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: serial }, meta),
    );
  });

  it('registers a vehicle sensor with no patient profile', async () => {
    const { user } = await makePatient();
    const result = await devices.registerDevice(
      { sub: user.id, role: 'platform_admin' },
      { device_type: 'vehicle_sensor', serial_number: `SN-${randomUUID()}`, vehicle_registration: 'T123ABC' }, meta,
    );
    deviceIds.push(result.id);
    assert.equal(result.patient_profile_id, null);
  });
});

describe('revocation', () => {
  it('is idempotent — revoking twice does not error', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    await devices.revokeDevice(result.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    await devices.revokeDevice(result.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.status, 'revoked');
  });
});

describe('telemetry', () => {
  it('ingests a batch and updates last_seen_at', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    await ingestTelemetry(result.id, [
      { metric: 'heart_rate', value: 72, recorded_at: new Date().toISOString() },
      { metric: 'spo2', value: 98, recorded_at: new Date().toISOString() },
    ]);

    const count = await prisma.deviceTelemetry.count({ where: { deviceId: result.id } });
    assert.equal(count, 2);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: result.id } });
    assert.ok(row.lastSeenAt);
  });
});

describe('alerts', () => {
  it('raises an alert and resolves the patient as a recipient', async () => {
    const { user, profile } = await makePatient();
    const result = await devices.registerDevice({ sub: user.id, role: 'patient', ppid: profile.id }, { device_type: 'wearable_watch', serial_number: `SN-${randomUUID()}` }, meta);
    deviceIds.push(result.id);

    const alert = await raiseDeviceAlert(result.id, { alert_type: 'fall_detected', detected_at: new Date().toISOString() });
    assert.ok(alert);

    const recipients = await prisma.deviceAlertRecipient.findMany({ where: { alertId: alert!.id } });
    assert.ok(recipients.some((r) => r.recipientType === 'patient' && r.recipientId === user.id));
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/devices exec tsc --noEmit"
echo "  pnpm --filter @a-health/devices test"
