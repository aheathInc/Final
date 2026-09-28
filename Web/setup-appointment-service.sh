#!/usr/bin/env bash
#
# Builds services/appointment — the scheduled entry route into a
# consultation, alongside services/consultation's on-demand route. Both
# converge on the same ConsultationRequest.
#
# Booking a slot does not open a consultation. Starting the appointment does
# — with the clinician already fixed by the booking, so this path never
# touches the triage/matching engine at all. No new schema is needed: the
# Appointment/Slot models and their relation to ConsultationRequest were part
# of the very first schema, built for exactly this.
#
# Run from the repo root:
#   bash setup-appointment-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/appointment"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

# ---------------------------------------------------------------------------
# Step 0: confirm every error code this service needs already exists.
# SLOT_UNAVAILABLE / SLOT_IN_PAST / APPOINTMENT_NOT_YET_STARTABLE /
# APPOINTMENT_ALREADY_STARTED were reserved in packages/http from day one —
# this just proves it instead of assuming it, after being burned twice by
# services that used codes the catalogue didn't have yet.
# ---------------------------------------------------------------------------
ERRORS="$ROOT/packages/http/src/errors.ts"
for code in SLOT_UNAVAILABLE SLOT_IN_PAST APPOINTMENT_NOT_YET_STARTABLE APPOINTMENT_ALREADY_STARTED STATE_TRANSITION_INVALID NOT_RESOURCE_OWNER; do
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
pkg.name = pkg.name || '@a-health/appointment';
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
  // 4004 was reserved for this service from the very first packages/config
  // SERVICE_PORTS list, between doctor (4003) and consultation (4005).
  PORT: z.coerce.number().default(4004),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** How far ahead of the slot a party may call start(). */
  START_WINDOW_MINUTES: z.coerce.number().default(15),
  SLA_ROUTINE_SECONDS: z.coerce.number().default(7200),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/appointment.types.ts" << 'TS'
import { z } from 'zod';

export const createAppointmentSchema = z.object({
  slot_id: z.string().uuid(),
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
});

export const listAppointmentsQuery = z.object({
  status: z.enum(['booked', 'started', 'completed', 'cancelled', 'no_show']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
TS

cat > "$SVC/src/services/appointment.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, recordChange, toCursorPage, unprocessable,
} from '@a-health/http';
import { env } from '../config/env.js';
import type { CreateAppointmentInput } from '../types/appointment.types.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseAppointment(a: {
  id: string; slotId: string; careThreadId: string | null; patientProfileId: string;
  clinicianId: string; consultationId?: string | null; startsAt: Date; durationMin: number;
  modality: string; reason: string | null; status: string; cancelledReason: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id,
    slot_id: a.slotId,
    care_thread_id: a.careThreadId,
    patient_profile_id: a.patientProfileId,
    clinician_id: a.clinicianId,
    consultation_id: a.consultationId ?? null,
    starts_at: a.startsAt.toISOString(),
    duration_minutes: a.durationMin,
    modality: a.modality,
    reason: a.reason,
    status: a.status,
    cancelled_reason: a.cancelledReason,
    version: a.version,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/** Minimal, contract-shaped serialiser — mirrors consultation.service's own, not imported across the service boundary. */
function serialiseConsultation(c: {
  id: string; careThreadId: string; patientProfileId: string; assignedClinicianId: string | null;
  appointmentId: string | null; channel: string; modality: string; urgencyLevel: string;
  triageRuleVersion: string; status: string; slaDeadlineAt: Date; escalationCount: number;
  createdAt: Date; acceptedAt: Date | null; completedAt: Date | null; version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    assigned_clinician_id: c.assignedClinicianId,
    referred_from_consultation_id: null,
    appointment_id: c.appointmentId,
    channel: c.channel,
    modality: c.modality,
    symptom_text: null,
    structured_symptoms: [],
    voice_note_key: null,
    urgency_level: c.urgencyLevel,
    triage_rule_version: c.triageRuleVersion,
    status: c.status,
    sla_deadline_at: c.slaDeadlineAt.toISOString(),
    escalation_count: c.escalationCount,
    created_at: c.createdAt.toISOString(),
    client_created_at: null,
    accepted_at: c.acceptedAt?.toISOString() ?? null,
    completed_at: c.completedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function resolvePatientProfileId(caller: Caller, requested: string | undefined): Promise<string> {
  const patientProfileId = requested ?? caller.ppid;
  if (!patientProfileId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot book an appointment for this patient');
  }
  return patientProfileId;
}

/**
 * Books a published slot.
 *
 * Slot contention is resolved by first write wins: the conditional update
 * (`isBooked: false` in the where clause) means a losing concurrent request
 * updates zero rows and is told the slot is gone, rather than double-booking
 * the clinician. Booking does not open a consultation — that is what start()
 * is for, kept separate so a no-show never leaves a clinical record behind.
 */
export async function createAppointment(caller: Caller, input: CreateAppointmentInput, meta: Meta) {
  const patientProfileId = await resolvePatientProfileId(caller, input.patient_profile_id);

  const slot = await prisma.slot.findUnique({ where: { id: input.slot_id } });
  if (!slot) throw notFound('Slot not found');
  if (slot.startsAt < new Date()) throw conflict('SLOT_IN_PAST', 'This slot has already passed');

  if (input.care_thread_id) {
    const thread = await prisma.careThread.findUnique({ where: { id: input.care_thread_id } });
    if (!thread) throw notFound('Care thread not found');
    if (thread.patientProfileId !== patientProfileId) {
      throw forbidden('NOT_RESOURCE_OWNER', 'That care thread does not belong to this patient');
    }
  }

  const claimed = await prisma.slot.updateMany({
    where: { id: input.slot_id, isBooked: false },
    data: { isBooked: true },
  });
  if (claimed.count !== 1) {
    throw conflict('SLOT_UNAVAILABLE', 'This slot has just been booked by someone else');
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        slotId: slot.id,
        careThreadId: input.care_thread_id ?? null,
        patientProfileId,
        clinicianId: slot.clinicianId,
        startsAt: slot.startsAt,
        durationMin: slot.durationMin,
        modality: slot.modality,
        reason: input.reason ?? null,
      },
    });
    await recordChange(tx, {
      entity: 'appointments', entityId: created.id, op: 'create',
      version: created.version, patientProfileId, clinicianId: slot.clinicianId,
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.booked',
    entityType: 'appointments', entityId: appointment.id,
    metadata: { slotId: slot.id, startsAt: slot.startsAt.toISOString() },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseAppointment(appointment);
}

async function assertVisible(appointment: { patientProfileId: string; clinicianId: string }, caller: Caller) {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && appointment.clinicianId === caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: appointment.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This appointment is not yours');
}

export async function getAppointment(appointmentId: string, caller: Caller) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);
  return serialiseAppointment(appointment);
}

export async function listAppointments(
  caller: Caller,
  query: { status?: string; from?: string; to?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { clinicianId: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.appointment.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.from || query.to
        ? { startsAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    orderBy: { startsAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseAppointment);
}

/**
 * Opens the consultation for a booked appointment. The clinician is already
 * fixed by the booking, so this never touches the triage or matching engine
 * — it creates the ConsultationRequest directly in `matched` state.
 *
 * Callable by either party from START_WINDOW_MINUTES before the slot. If the
 * appointment carries no care_thread_id, one is opened here — and if the
 * thread it does carry was closed, it is reopened, the same rule
 * services/consultation applies when a problem resurfaces.
 */
export async function startAppointment(appointmentId: string, caller: Caller, meta: Meta) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);

  if (appointment.status !== 'booked') {
    throw conflict('APPOINTMENT_ALREADY_STARTED', `This appointment is already "${appointment.status}"`);
  }
  const earliestStart = new Date(appointment.startsAt.getTime() - env.START_WINDOW_MINUTES * 60_000);
  if (new Date() < earliestStart) {
    throw conflict('APPOINTMENT_NOT_YET_STARTABLE', 'It is too early to start this appointment');
  }

  const result = await prisma.$transaction(async (tx) => {
    let threadId = appointment.careThreadId;

    if (threadId) {
      const thread = await tx.careThread.findUniqueOrThrow({ where: { id: threadId } });
      if (thread.status === 'closed') {
        await tx.careThread.update({
          where: { id: threadId },
          data: { status: 'open', closedAt: null, outcome: null, version: { increment: 1 } },
        });
      }
    } else {
      const thread = await tx.careThread.create({
        data: {
          patientProfileId: appointment.patientProfileId,
          reasonSummary: appointment.reason ?? 'Scheduled appointment',
        },
      });
      threadId = thread.id;
    }

    const consultation = await tx.consultationRequest.create({
      data: {
        careThreadId: threadId,
        patientProfileId: appointment.patientProfileId,
        assignedClinicianId: appointment.clinicianId,
        appointmentId: appointment.id,
        channel: 'app',
        modality: appointment.modality,
        // No triage ran: the clinician and time were fixed at booking, not
        // derived from symptoms. The version is recorded as a fixed marker
        // for the same audit reason every other consultation stamps a real
        // triage version — so a reviewer never mistakes this for a triage
        // decision that happened and was simply not logged.
        urgencyLevel: 'routine',
        triageRuleVersion: 'scheduled-appointment-no-triage',
        status: 'matched',
        acceptedAt: new Date(),
        slaDeadlineAt: new Date(Date.now() + env.SLA_ROUTINE_SECONDS * 1000),
      },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: 'started', version: { increment: 1 } },
    });

    await tx.careThread.update({
      where: { id: threadId },
      data: {
        latestConsultationId: consultation.id,
        openConsultationCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await tx.clinicianProfile.update({
      where: { id: appointment.clinicianId },
      data: { currentLoad: { increment: 1 }, version: { increment: 1 } },
    });

    return consultation;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.started',
    entityType: 'appointments', entityId: appointment.id,
    metadata: { consultationId: result.id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseConsultation(result);
}

/**
 * Cancelling releases the slot back to the pool. Only legal while `booked` —
 * once started, a consultation may already be in progress, and "cancelling"
 * that is a clinical action (closing the consultation), not a scheduling one.
 */
export async function cancelAppointment(appointmentId: string, caller: Caller, reason: string | undefined, meta: Meta) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);

  if (appointment.status !== 'booked') {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot cancel an appointment in status "${appointment.status}"`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: 'cancelled', cancelledReason: reason ?? null, version: { increment: 1 } },
    });
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });
    return row;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'appointment.cancelled',
    entityType: 'appointments', entityId: appointment.id,
    reason: reason ?? null, ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseAppointment(updated);
}
TS

cat > "$SVC/src/controllers/appointment.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as appointments from '../services/appointment.service.js';
import {
  cancelAppointmentSchema, createAppointmentSchema, listAppointmentsQuery,
} from '../types/appointment.types.js';

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
  (req, res) => appointments.createAppointment(caller(req), createAppointmentSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => appointments.listAppointments(caller(req), listAppointmentsQuery.parse(req.query)));

export const getOne = handle((req) => appointments.getAppointment(pathParam(req, 'appointment_id'), caller(req)));

export const start = handle(
  (req, res) => appointments.startAppointment(pathParam(req, 'appointment_id'), caller(req), meta(req, res)), 201,
);

export const cancel = handle((req, res) => {
  const input = cancelAppointmentSchema.parse(req.body ?? {});
  return appointments.cancelAppointment(pathParam(req, 'appointment_id'), caller(req), input.reason, meta(req, res));
});
TS

cat > "$SVC/src/routes/appointment.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/appointment.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const appointmentRouter = Router();

appointmentRouter.post('/appointments', requireAuth, idempotency, c.create);
appointmentRouter.get('/appointments', requireAuth, c.list);
appointmentRouter.get('/appointments/:appointment_id', requireAuth, c.getOne);
appointmentRouter.post('/appointments/:appointment_id/start', requireAuth, idempotency, c.start);
appointmentRouter.post('/appointments/:appointment_id/cancel', requireAuth, idempotency, c.cancel);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { appointmentRouter } from './routes/appointment.routes.js';

const service = createService({
  name: 'appointment',
  port: env.PORT,
  routers: [appointmentRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4004"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/appointment.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as appointments from '../services/appointment.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const slotIds: string[] = [];
const appointmentIds: string[] = [];
const threadIds: string[] = [];

after(async () => {
  for (const id of appointmentIds) {
    await prisma.consultationRequest.deleteMany({ where: { appointmentId: id } }).catch(() => undefined);
    await prisma.appointment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of slotIds) {
    await prisma.slot.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Appt Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Appt Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Appt Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeSlot(clinicianId: string, minutesFromNow: number) {
  const slot = await prisma.slot.create({
    data: { clinicianId, startsAt: new Date(Date.now() + minutesFromNow * 60_000), durationMin: 30, modality: 'chat' },
  });
  slotIds.push(slot.id);
  return slot;
}

describe('booking', () => {
  it('books a future slot and marks it unavailable', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);

    const result = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id },
      { slot_id: slot.id }, meta,
    );
    appointmentIds.push(result.id);
    assert.equal(result.status, 'booked');

    const reloaded = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloaded.isBooked, true);
  });

  it('refuses a slot that is already booked', async () => {
    const { user: u1, profile: p1 } = await makePatient();
    const { user: u2, profile: p2 } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 180);

    const first = await appointments.createAppointment({ sub: u1.id, role: 'patient', ppid: p1.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(first.id);

    await assert.rejects(
      () => appointments.createAppointment({ sub: u2.id, role: 'patient', ppid: p2.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_UNAVAILABLE',
    );
  });

  it('refuses a slot in the past', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, -30);

    await assert.rejects(
      () => appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_IN_PAST',
    );
  });
});

describe('starting', () => {
  it('refuses to start more than the window ahead of the slot', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_NOT_YET_STARTABLE',
    );
  });

  it('opens a matched consultation with no triage, inside the window', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const consultation = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(consultation.care_thread_id);

    assert.equal(consultation.status, 'matched');
    assert.equal(consultation.assigned_clinician_id, clinician.id);
    assert.equal(consultation.appointment_id, booked.id);

    const reloadedAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    assert.equal(reloadedAppt.status, 'started');
  });

  it('refuses to start an appointment twice', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const first = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(first.care_thread_id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_ALREADY_STARTED',
    );
  });

  it('reopens a closed care thread rather than orphaning the new consultation', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, status: 'closed', closedAt: new Date() } });
    threadIds.push(thread.id);
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id, care_thread_id: thread.id }, meta,
    );
    appointmentIds.push(booked.id);

    await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);

    const reloadedThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(reloadedThread.status, 'open');
  });
});

describe('cancelling', () => {
  it('releases the slot on cancel', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const cancelled = await appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, 'changed my mind', meta);
    assert.equal(cancelled.status, 'cancelled');

    const reloadedSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloadedSlot.isBooked, false);
  });

  it('refuses to cancel an already-started appointment', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const started = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(started.care_thread_id);

    await assert.rejects(
      () => appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('visibility', () => {
  it('refuses a stranger', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lets the assigned clinician see it', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const result = await appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id });
    assert.equal(result.id, booked.id);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/appointment exec tsc --noEmit"
echo "  pnpm --filter @a-health/appointment test"
