#!/usr/bin/env bash
#
# Builds services/followup — the service that makes "follow-up till cure" a
# mechanism rather than a slogan.
#
# Three pieces:
#   * a scheduling worker that generates due check-ins from active cycles
#   * deviation evaluation — computed server-side against recovery_criteria,
#     never trusted from the client
#   * adherence confirmation, feeding off the AdherenceLog rows the
#     consultation service already writes on prescribe
#
# Run from the repo root:
#   bash setup-followup-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/followup"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,workers,engine,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/followup';
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
  PORT: z.coerce.number().default(4007),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().default(15),
  SCHEDULE_HORIZON_DAYS: z.coerce.number().default(2),
  MISSED_AFTER_HOURS: z.coerce.number().default(24),
  ADHERENCE_MISS_THRESHOLD: z.coerce.number().default(3),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/types/followup.types.ts" << 'TS'
import { z } from 'zod';

export const respondSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const closeCycleSchema = z.object({
  outcome: z.enum(['recovered', 'escalated', 'lost_to_follow_up']),
  notes: z.string().max(2000).optional(),
});

export const confirmAdherenceSchema = z.object({
  reported_status: z.enum(['taken', 'missed', 'delayed']),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
  note: z.string().max(500).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const listCheckInsQuery = z.object({
  status: z.enum(['scheduled', 'responded', 'missed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listAdherenceQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  reported_status: z.enum(['taken', 'missed', 'delayed', 'unreported']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type RespondInput = z.infer<typeof respondSchema>;
export type ConfirmAdherenceInput = z.infer<typeof confirmAdherenceSchema>;
TS

cat > "$SVC/src/engine/deviation.ts" << 'TS'
/**
 * Evaluates a check-in response against the cycle's recovery_criteria.
 *
 * This is the guard the whole check-in system exists to enforce: `is_deviation`
 * is computed here, from server-held criteria, never accepted from the client.
 * A patient's phone deciding whether their own recovery looks normal would
 * defeat the point of asking a clinician to set the threshold.
 *
 * Deliberately permissive about shape: recovery_criteria is clinician-authored
 * JSON, and a criterion this evaluator does not recognise is skipped rather
 * than treated as a match. Silently ignoring an unknown criterion is safer
 * than silently passing a check that was never actually evaluated.
 */

export interface DeviationCriteria {
  vital_bounds?: Record<string, { min?: number; max?: number }>;
  red_flag_fields?: string[];
  concerning_phrases?: Record<string, string[]>;
  no_decline_below?: Record<string, number>;
}

export interface DeviationResult {
  isDeviation: boolean;
  reasons: string[];
}

export function evaluateDeviation(
  responses: Record<string, unknown>,
  criteria: DeviationCriteria,
): DeviationResult {
  const reasons: string[] = [];

  for (const [field, bounds] of Object.entries(criteria.vital_bounds ?? {})) {
    const value = responses[field];
    if (typeof value !== 'number') continue;
    if (bounds.min !== undefined && value < bounds.min) {
      reasons.push(field + '=' + value + ' below minimum ' + bounds.min);
    }
    if (bounds.max !== undefined && value > bounds.max) {
      reasons.push(field + '=' + value + ' above maximum ' + bounds.max);
    }
  }

  for (const field of criteria.red_flag_fields ?? []) {
    if (responses[field] === true) {
      reasons.push(field + ' reported true');
    }
  }

  for (const [field, phrases] of Object.entries(criteria.concerning_phrases ?? {})) {
    const value = responses[field];
    if (typeof value !== 'string') continue;
    const lower = value.toLowerCase();
    for (const phrase of phrases) {
      if (lower.includes(phrase.toLowerCase())) {
        reasons.push(field + ' mentions "' + phrase + '"');
        break;
      }
    }
  }

  for (const [field, minimum] of Object.entries(criteria.no_decline_below ?? {})) {
    const value = responses[field];
    if (typeof value === 'number' && value < minimum) {
      reasons.push(field + '=' + value + ' below required ' + minimum);
    }
  }

  return { isDeviation: reasons.length > 0, reasons };
}
TS

cat > "$SVC/src/services/checkin.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage,
} from '@a-health/http';
import { evaluateDeviation, type DeviationCriteria } from '../engine/deviation.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseCycle(c: {
  id: string; careThreadId: string; patientProfileId: string; clinicianId: string;
  sourceConsultationId: string; frequency: string; customCron: string | null;
  questionnaireKey: string | null; recoveryCriteria: unknown;
  startDate: Date; endDate: Date; status: string; outcome: string | null;
  openDeviationCount: number; version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    clinician_id: c.clinicianId,
    source_consultation_id: c.sourceConsultationId,
    frequency: c.frequency,
    custom_cron: c.customCron,
    questionnaire_key: c.questionnaireKey,
    recovery_criteria: c.recoveryCriteria ?? {},
    start_date: c.startDate.toISOString().slice(0, 10),
    end_date: c.endDate.toISOString().slice(0, 10),
    status: c.status,
    outcome: c.outcome,
    open_deviation_count: c.openDeviationCount,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

function serialiseCheckIn(c: {
  id: string; followUpCycleId: string; careThreadId: string;
  scheduledAt: Date; status: string; questions: unknown; responses: unknown;
  isDeviation: boolean; deviationReasons: unknown;
  reviewedById: string | null; reviewedAt: Date | null;
  respondedAt: Date | null; channel: string | null;
  version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    follow_up_cycle_id: c.followUpCycleId,
    care_thread_id: c.careThreadId,
    scheduled_at: c.scheduledAt.toISOString(),
    status: c.status,
    questions: c.questions ?? [],
    responses: c.responses ?? null,
    is_deviation: c.isDeviation,
    deviation_reasons: c.deviationReasons ?? [],
    reviewed_by_id: c.reviewedById,
    reviewed_at: c.reviewedAt?.toISOString() ?? null,
    responded_at: c.respondedAt?.toISOString() ?? null,
    channel: c.channel,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function assertCycleAccess(cycleId: string, caller: Caller) {
  const cycle = await prisma.followUpCycle.findUnique({
    where: { id: cycleId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!cycle) throw notFound('Follow-up cycle not found');

  const allowed =
    caller.role === 'platform_admin' ||
    cycle.clinicianId === caller.cpid ||
    cycle.patient.userId === caller.sub ||
    cycle.patient.guardianUserId === caller.sub;
  if (!allowed) throw forbidden('NOT_RESOURCE_OWNER', 'This follow-up cycle is not yours');
  return cycle;
}

export async function getCycle(cycleId: string, caller: Caller) {
  const cycle = await assertCycleAccess(cycleId, caller);
  return serialiseCycle(cycle);
}

export async function listCheckIns(
  cycleId: string, caller: Caller,
  query: { status?: string; cursor?: string; limit: number },
) {
  await assertCycleAccess(cycleId, caller);
  const rows = await prisma.checkIn.findMany({
    where: { followUpCycleId: cycleId, ...(query.status ? { status: query.status as never } : {}) },
    orderBy: { scheduledAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseCheckIn);
}

/**
 * The one clinically load-bearing write in this service. `is_deviation` is
 * computed here from the cycle's own recovery_criteria — never sent by the
 * client — and a positive result raises open_deviation_count on the cycle,
 * which is what a clinician's review queue is built from.
 */
export async function respondToCheckIn(
  checkInId: string, caller: Caller,
  input: { responses: Record<string, unknown>; channel?: string; client_created_at?: string },
  meta: Meta,
) {
  const checkIn = await prisma.checkIn.findUnique({
    where: { id: checkInId },
    include: {
      followUpCycle: {
        include: { patient: { select: { userId: true, guardianUserId: true } } },
      },
    },
  });
  if (!checkIn) throw notFound('Check-in not found');

  const cycle = checkIn.followUpCycle;
  const owns = cycle.patient.userId === caller.sub || cycle.patient.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This check-in is not yours to answer');
  }
  if (checkIn.status === 'responded') {
    throw conflict('CHECK_IN_ALREADY_ANSWERED', 'This check-in has already been answered');
  }

  const criteria = (cycle.recoveryCriteria ?? {}) as DeviationCriteria;
  const evaluation = evaluateDeviation(input.responses, criteria);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.checkIn.update({
      where: { id: checkInId },
      data: {
        responses: input.responses as never,
        status: 'responded',
        isDeviation: evaluation.isDeviation,
        deviationReasons: evaluation.reasons as never,
        respondedAt: input.client_created_at ? new Date(input.client_created_at) : new Date(),
        channel: (input.channel ?? 'app') as never,
        version: { increment: 1 },
      },
    });

    if (evaluation.isDeviation) {
      await tx.followUpCycle.update({
        where: { id: cycle.id },
        data: { openDeviationCount: { increment: 1 } },
      });
    }

    return row;
  });

  if (evaluation.isDeviation) {
    await appendAudit({
      actorUserId: caller.sub,
      action: 'checkin.deviation_flagged',
      entityType: 'check_ins',
      entityId: checkInId,
      metadata: { reasons: evaluation.reasons, cycleId: cycle.id },
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
  }

  return serialiseCheckIn(updated);
}

/**
 * Manual override. Cycles also close automatically when a scheduler-driven
 * completion condition is met (end date reached with no open deviation); this
 * is the clinician's early-exit or early-escalation path.
 */
export async function closeCycle(
  cycleId: string, caller: Caller, outcome: string, notes: string | undefined, meta: Meta,
) {
  const cycle = await prisma.followUpCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw notFound('Follow-up cycle not found');
  if (cycle.clinicianId !== caller.cpid && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'Only the assigned clinician may close this cycle');
  }
  if (cycle.status !== 'active') {
    throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'This cycle is already closed');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.followUpCycle.update({
      where: { id: cycleId },
      data: { status: 'completed', outcome: outcome as never, version: { increment: 1 } },
    });

    await tx.careThread.updateMany({
      where: { id: cycle.careThreadId, activeFollowUpCycleId: cycleId },
      data: { activeFollowUpCycleId: null },
    });

    await tx.checkIn.updateMany({
      where: { followUpCycleId: cycleId, status: 'scheduled' },
      data: { status: 'missed' },
    });

    return row;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'followup.cycle_closed',
    entityType: 'follow_up_cycles', entityId: cycleId,
    reason: notes ?? null, metadata: { outcome },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseCycle(updated);
}
TS

cat > "$SVC/src/services/adherence.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(a: {
  id: string; prescriptionItemId: string; prescriptionId: string; patientProfileId: string;
  medicationName: string; dosage: string; scheduledAt: Date; reportedStatus: string;
  reportedAt: Date | null; note: string | null; channel: string | null;
  version: number; updatedAt: Date;
}) {
  return {
    id: a.id,
    prescription_item_id: a.prescriptionItemId,
    prescription_id: a.prescriptionId,
    patient_profile_id: a.patientProfileId,
    medication_name: a.medicationName,
    dosage: a.dosage,
    scheduled_at: a.scheduledAt.toISOString(),
    reported_status: a.reportedStatus,
    reported_at: a.reportedAt?.toISOString() ?? null,
    note: a.note,
    channel: a.channel,
    version: a.version,
    updated_at: a.updatedAt.toISOString(),
  };
}

async function visibleProfileIds(caller: Caller): Promise<string[] | 'all'> {
  if (caller.role === 'platform_admin') return 'all';
  const rows = await prisma.patientProfile.findMany({
    where: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listAdherence(
  caller: Caller,
  query: {
    patient_profile_id?: string;
    from?: string; to?: string;
    reported_status?: string;
    cursor?: string; limit: number;
  },
) {
  const visible = await visibleProfileIds(caller);
  if (query.patient_profile_id && visible !== 'all' && !visible.includes(query.patient_profile_id)) {
    throw forbidden('NOT_RESOURCE_OWNER', "You cannot view this patient's adherence log");
  }

  const rows = await prisma.adherenceLog.findMany({
    where: {
      ...(query.patient_profile_id
        ? { patientProfileId: query.patient_profile_id }
        : visible !== 'all' ? { patientProfileId: { in: visible } } : {}),
      ...(query.from || query.to
        ? { scheduledAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.reported_status ? { reportedStatus: query.reported_status as never } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}

/**
 * Confirms one scheduled dose. Reachable identically from an app tap, an SMS
 * reply, or a USSD menu selection — the gateway translates all three into this
 * same call, so there is exactly one place adherence logic lives.
 *
 * Repeated missed doses raise a task for the clinician. Recording
 * non-adherence without acting on it changes nothing, which is the whole
 * point of tracking it at all.
 */
export async function confirmDose(
  adherenceLogId: string,
  caller: Caller,
  input: { reported_status: string; channel?: string; note?: string; client_created_at?: string },
  missThreshold: number,
  meta: Meta,
) {
  const log = await prisma.adherenceLog.findUnique({
    where: { id: adherenceLogId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!log) throw notFound('Adherence log entry not found');

  const owns = log.patient.userId === caller.sub || log.patient.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This dose record is not yours');
  }

  const updated = await prisma.adherenceLog.update({
    where: { id: adherenceLogId },
    data: {
      reportedStatus: input.reported_status as never,
      reportedAt: input.client_created_at ? new Date(input.client_created_at) : new Date(),
      note: input.note ?? null,
      channel: (input.channel ?? 'app') as never,
      version: { increment: 1 },
    },
  });

  if (input.reported_status === 'missed') {
    const recent = await prisma.adherenceLog.findMany({
      where: { prescriptionId: log.prescriptionId },
      orderBy: { scheduledAt: 'desc' },
      take: missThreshold,
    });
    const consecutiveMissed = recent.length === missThreshold && recent.every((r) => r.reportedStatus === 'missed');

    if (consecutiveMissed) {
      await appendAudit({
        actorUserId: caller.sub,
        action: 'adherence.repeated_missed_doses',
        entityType: 'adherence_logs',
        entityId: adherenceLogId,
        metadata: { prescriptionId: log.prescriptionId, consecutiveMissed: missThreshold },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      });
    }
  }

  return serialise(updated);
}
TS

cat > "$SVC/src/workers/scheduler.worker.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('followup.scheduler');

const INTERVAL_HOURS: Record<string, number> = {
  daily: 24,
  twice_daily: 12,
  weekly: 168,
};

export interface SchedulerResult {
  cyclesProcessed: number;
  checkInsCreated: number;
  cyclesAutoClosed: number;
}

/**
 * Generates due check-ins from active cycles, and closes a cycle whose window
 * has ended cleanly — reached its end date with no unresolved deviation.
 *
 * Idempotent by construction: each pass only creates a check-in for a slot
 * that does not already have one, so running the tick twice in the same
 * window is harmless.
 */
export async function tick(now = new Date()): Promise<SchedulerResult> {
  const cycles = await prisma.followUpCycle.findMany({
    where: { status: 'active' },
    take: 500,
  });

  let checkInsCreated = 0;
  let cyclesAutoClosed = 0;

  for (const cycle of cycles) {
    if (cycle.endDate < now) {
      if (cycle.openDeviationCount === 0) {
        await prisma.$transaction([
          prisma.followUpCycle.update({
            where: { id: cycle.id },
            data: { status: 'completed', outcome: 'recovered', version: { increment: 1 } },
          }),
          prisma.careThread.updateMany({
            where: { id: cycle.careThreadId, activeFollowUpCycleId: cycle.id },
            data: { activeFollowUpCycleId: null },
          }),
        ]);
        cyclesAutoClosed += 1;
      }
      // A cycle past its end date with an open deviation is left active
      // deliberately — a clinical concern that has not been resolved does not
      // get closed by a timer.
      continue;
    }

    const intervalHours =
      cycle.frequency === 'custom' ? 24 : (INTERVAL_HOURS[cycle.frequency] ?? 24);

    const horizon = new Date(now.getTime() + env.SCHEDULE_HORIZON_DAYS * 86400000);
    const existing = await prisma.checkIn.findMany({
      where: { followUpCycleId: cycle.id, scheduledAt: { lte: horizon } },
      select: { scheduledAt: true },
    });
    const existingTimes = new Set(existing.map((e) => e.scheduledAt.getTime()));

    const toCreate: { followUpCycleId: string; careThreadId: string; scheduledAt: Date; questions: unknown }[] = [];
    for (
      let t = cycle.startDate.getTime();
      t <= Math.min(horizon.getTime(), cycle.endDate.getTime());
      t += intervalHours * 3600000
    ) {
      if (t < now.getTime() - 3600000) continue;
      if (existingTimes.has(t)) continue;
      toCreate.push({
        followUpCycleId: cycle.id,
        careThreadId: cycle.careThreadId,
        scheduledAt: new Date(t),
        questions: cycle.questionnaireKey
          ? [{ key: cycle.questionnaireKey }]
          : [{ key: 'general_wellbeing' }],
      });
    }

    if (toCreate.length > 0) {
      await prisma.checkIn.createMany({ data: toCreate as never });
      checkInsCreated += toCreate.length;
    }
  }

  // A check-in nobody answered long enough ago is not still "scheduled" —
  // it is missed, and a missed check-in is itself a signal worth a clinician
  // seeing, not a silently expiring row.
  const missedCutoff = new Date(now.getTime() - env.MISSED_AFTER_HOURS * 3600000);
  const missed = await prisma.checkIn.updateMany({
    where: { status: 'scheduled', scheduledAt: { lt: missedCutoff } },
    data: { status: 'missed' },
  });

  if (missed.count > 0) logger.warn('check-ins marked missed', { count: missed.count });

  return { cyclesProcessed: cycles.length, checkInsCreated, cyclesAutoClosed };
}

export function startScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick()
      .then((r) => {
        if (r.checkInsCreated + r.cyclesAutoClosed > 0) logger.info('scheduler tick', { ...r });
      })
      .catch((e) => logger.error('scheduler tick failed', { err: String(e) }));
  }, env.SCHEDULER_INTERVAL_MINUTES * 60000);
  timer.unref();
  logger.info('scheduler started', { intervalMinutes: env.SCHEDULER_INTERVAL_MINUTES });
  return timer;
}
TS

cat > "$SVC/src/controllers/followup.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as checkins from '../services/checkin.service.js';
import * as adherence from '../services/adherence.service.js';
import { env } from '../config/env.js';
import {
  closeCycleSchema, confirmAdherenceSchema, listAdherenceQuery,
  listCheckInsQuery, respondSchema,
} from '../types/followup.types.js';

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

export const getCycle = handle((req) =>
  checkins.getCycle(pathParam(req, 'follow_up_cycle_id'), caller(req)));

export const listCheckIns = handle((req) =>
  checkins.listCheckIns(pathParam(req, 'follow_up_cycle_id'), caller(req), listCheckInsQuery.parse(req.query)));

export const respondToCheckIn = handle((req, res) =>
  checkins.respondToCheckIn(pathParam(req, 'check_in_id'), caller(req), respondSchema.parse(req.body), meta(req, res)));

export const closeCycle = handle((req, res) => {
  const input = closeCycleSchema.parse(req.body);
  return checkins.closeCycle(pathParam(req, 'follow_up_cycle_id'), caller(req), input.outcome, input.notes, meta(req, res));
});

export const listAdherence = handle((req) =>
  adherence.listAdherence(caller(req), listAdherenceQuery.parse(req.query)));

export const confirmAdherence = handle((req, res) =>
  adherence.confirmDose(
    pathParam(req, 'adherence_log_id'), caller(req), confirmAdherenceSchema.parse(req.body),
    env.ADHERENCE_MISS_THRESHOLD, meta(req, res),
  ));
TS

cat > "$SVC/src/routes/followup.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/followup.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const followupRouter = Router();

followupRouter.get('/follow-up-cycles/:follow_up_cycle_id', requireAuth, c.getCycle);
followupRouter.get('/follow-up-cycles/:follow_up_cycle_id/check-ins', requireAuth, c.listCheckIns);
followupRouter.post('/follow-up-cycles/:follow_up_cycle_id/close', requireAuth, idempotency, c.closeCycle);

followupRouter.post('/check-ins/:check_in_id/respond', requireAuth, idempotency, c.respondToCheckIn);

followupRouter.get('/adherence-logs', requireAuth, c.listAdherence);
followupRouter.post('/adherence-logs/:adherence_log_id/confirm', requireAuth, idempotency, c.confirmAdherence);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { followupRouter } from './routes/followup.routes.js';
import { startScheduler } from './workers/scheduler.worker.js';

const service = createService({
  name: 'followup',
  port: env.PORT,
  routers: [followupRouter],
  development: env.NODE_ENV === 'development',
});

startScheduler();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4007"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written"
fi

cat > "$SVC/src/tests/followup.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { evaluateDeviation } from '../engine/deviation.js';
import * as checkins from '../services/checkin.service.js';
import * as adherence from '../services/adherence.service.js';
import { tick } from '../workers/scheduler.worker.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threads: string[] = [];
const consultationsCreated: string[] = [];
const prescriptions: string[] = [];

after(async () => {
  for (const id of prescriptions) {
    await prisma.adherenceLog.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: id } }).catch(() => undefined);
    await prisma.prescription.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threads) {
    await prisma.checkIn.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.followUpCycle.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    for (const cid of consultationsCreated) {
      await prisma.consultationRequest.deleteMany({ where: { id: cid, careThreadId: id } }).catch(() => undefined);
    }
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
    data: { phoneNumber: '+2557' + randomInt(10000000, 99999999), role: 'patient', status: 'active', fullName: 'Followup Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Followup Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: '+2557' + randomInt(10000000, 99999999), email: randomUUID() + '@test.local', role: 'clinician', status: 'active', fullName: 'Followup Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: 'TEST-' + randomUUID().slice(0, 12), specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeThread(patientProfileId: string) {
  const thread = await prisma.careThread.create({ data: { patientProfileId } });
  threads.push(thread.id);
  return thread;
}

async function makeConsultation(threadId: string, patientProfileId: string, clinicianId: string) {
  const c = await prisma.consultationRequest.create({
    data: {
      careThreadId: threadId, patientProfileId, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine',
      triageRuleVersion: 'test', status: 'completed',
      slaDeadlineAt: new Date(Date.now() + 3600000),
    },
  });
  consultationsCreated.push(c.id);
  return c;
}

async function makeCycle(criteria: Record<string, unknown> = {}) {
  const { profile } = await makePatient();
  const clinician = await makeClinician();
  const thread = await makeThread(profile.id);
  const consultation = await makeConsultation(thread.id, profile.id, clinician.id);
  const cycle = await prisma.followUpCycle.create({
    data: {
      careThreadId: thread.id, patientProfileId: profile.id, clinicianId: clinician.id,
      sourceConsultationId: consultation.id, frequency: 'daily',
      recoveryCriteria: criteria as never,
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 6 * 86400000),
    },
  });
  return { cycle, patient: profile, clinician, thread };
}

describe('deviation engine', () => {
  it('flags a vital outside its bound', () => {
    const r = evaluateDeviation({ systolic: 165 }, { vital_bounds: { systolic: { max: 140 } } });
    assert.equal(r.isDeviation, true);
    assert.ok(r.reasons[0]!.includes('systolic'));
  });

  it('passes a vital inside its bound', () => {
    const r = evaluateDeviation({ systolic: 120 }, { vital_bounds: { systolic: { max: 140 } } });
    assert.equal(r.isDeviation, false);
  });

  it('flags a red-flag field reported true', () => {
    const r = evaluateDeviation({ wound_discharge: true }, { red_flag_fields: ['wound_discharge'] });
    assert.equal(r.isDeviation, true);
  });

  it('skips an unrecognised criterion rather than treating it as a match', () => {
    const r = evaluateDeviation({ mood: 'fine' }, { vital_bounds: { unknown_field: { max: 1 } } } as never);
    assert.equal(r.isDeviation, false);
  });

  it('flags a concerning phrase in free text', () => {
    const r = evaluateDeviation(
      { notes: 'wound has a foul smell today' },
      { concerning_phrases: { notes: ['foul smell', 'pus'] } },
    );
    assert.equal(r.isDeviation, true);
  });
});

describe('check-in response', () => {
  it('computes is_deviation server-side, ignoring any client-supplied value', async () => {
    const { cycle, patient } = await makeCycle({ vital_bounds: { systolic: { max: 140 } } });
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });

    const result = await checkins.respondToCheckIn(
      checkIn.id,
      { sub: patient.userId!, role: 'patient' },
      { responses: { systolic: 180 } },
      meta,
    );

    assert.equal(result.is_deviation, true);
    const reloadedCycle = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloadedCycle.openDeviationCount, 1);
  });

  it('refuses to answer an already-answered check-in', async () => {
    const { cycle, patient } = await makeCycle();
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    await checkins.respondToCheckIn(checkIn.id, { sub: patient.userId!, role: 'patient' }, { responses: {} }, meta);

    await assert.rejects(
      () => checkins.respondToCheckIn(checkIn.id, { sub: patient.userId!, role: 'patient' }, { responses: {} }, meta),
      (e: AppError) => e.code === 'CHECK_IN_ALREADY_ANSWERED',
    );
  });

  it('refuses a stranger', async () => {
    const { cycle } = await makeCycle();
    const checkIn = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(), questions: [] },
    });
    await assert.rejects(
      () => checkins.respondToCheckIn(checkIn.id, { sub: randomUUID(), role: 'patient' }, { responses: {} }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('cycle closing', () => {
  it('marks remaining scheduled check-ins as missed', async () => {
    const { cycle, clinician } = await makeCycle();
    await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(Date.now() + 86400000), questions: [] },
    });

    await checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta);

    const remaining = await prisma.checkIn.findMany({ where: { followUpCycleId: cycle.id } });
    assert.ok(remaining.every((c) => c.status === 'missed'));
  });

  it('refuses to close an already-closed cycle', async () => {
    const { cycle, clinician } = await makeCycle();
    await checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta);

    await assert.rejects(
      () => checkins.closeCycle(cycle.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, 'recovered', undefined, meta),
      (e: AppError) => e.code === 'FOLLOW_UP_CYCLE_CLOSED',
    );
  });
});

describe('scheduler', () => {
  it('creates due check-ins for an active cycle', async () => {
    const { cycle } = await makeCycle();
    const before = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    await tick();
    const after = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    assert.ok(after > before);
  });

  it('is idempotent - a second tick creates no duplicates', async () => {
    const { cycle } = await makeCycle();
    await tick();
    const afterFirst = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    await tick();
    const afterSecond = await prisma.checkIn.count({ where: { followUpCycleId: cycle.id } });
    assert.equal(afterFirst, afterSecond);
  });

  it('auto-closes a cycle past its end date with no open deviation', async () => {
    const { cycle: c1 } = await makeCycle();
    const past = await prisma.followUpCycle.update({
      where: { id: c1.id },
      data: { endDate: new Date(Date.now() - 3600000) },
    });
    await tick();
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: past.id } });
    assert.equal(reloaded.status, 'completed');
  });

  it('does not auto-close a cycle with an open deviation', async () => {
    const { cycle } = await makeCycle();
    await prisma.followUpCycle.update({
      where: { id: cycle.id },
      data: { endDate: new Date(Date.now() - 3600000), openDeviationCount: 1 },
    });
    await tick();
    const reloaded = await prisma.followUpCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(reloaded.status, 'active');
  });

  it('marks a long-overdue check-in as missed', async () => {
    const { cycle } = await makeCycle();
    const old = await prisma.checkIn.create({
      data: { followUpCycleId: cycle.id, careThreadId: cycle.careThreadId, scheduledAt: new Date(Date.now() - 48 * 3600000), questions: [] },
    });
    await tick();
    const reloaded = await prisma.checkIn.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(reloaded.status, 'missed');
  });
});

describe('adherence', () => {
  async function makePrescriptionWithDoses(count: number) {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await makeThread(profile.id);
    const consultation = await makeConsultation(thread.id, profile.id, clinician.id);
    const prescription = await prisma.prescription.create({
      data: {
        careThreadId: thread.id, consultationId: consultation.id, patientProfileId: profile.id,
        prescribedById: clinician.id,
        items: { create: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 1, durationDays: count }] },
      },
      include: { items: true },
    });
    prescriptions.push(prescription.id);

    const item = prescription.items[0]!;
    const logs = [];
    for (let i = 0; i < count; i += 1) {
      logs.push(await prisma.adherenceLog.create({
        data: {
          prescriptionItemId: item.id, prescriptionId: prescription.id, patientProfileId: profile.id,
          medicationName: item.medicationName, dosage: item.dosage,
          scheduledAt: new Date(Date.now() - (count - i) * 86400000),
        },
      }));
    }
    return { profile, prescription, logs };
  }

  it('confirms a dose as taken', async () => {
    const { profile, logs } = await makePrescriptionWithDoses(1);
    const result = await adherence.confirmDose(
      logs[0]!.id, { sub: profile.userId!, role: 'patient' },
      { reported_status: 'taken' }, 3, meta,
    );
    assert.equal(result.reported_status, 'taken');
  });

  it('refuses a stranger confirming a dose', async () => {
    const { logs } = await makePrescriptionWithDoses(1);
    await assert.rejects(
      () => adherence.confirmDose(logs[0]!.id, { sub: randomUUID(), role: 'patient' }, { reported_status: 'taken' }, 3, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('raises an audit entry after consecutive missed doses', async () => {
    const { profile, logs } = await makePrescriptionWithDoses(3);
    for (const log of logs) {
      await adherence.confirmDose(log.id, { sub: profile.userId!, role: 'patient' }, { reported_status: 'missed' }, 3, meta);
    }
    const entries = await prisma.auditLog.count({ where: { action: 'adherence.repeated_missed_doses', entityId: logs[2]!.id } });
    assert.equal(entries, 1);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/followup exec tsc --noEmit"
echo "  pnpm --filter @a-health/followup test"
