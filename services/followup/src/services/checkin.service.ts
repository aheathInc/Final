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
  const updated = await prisma.$transaction(async (tx) => {
    const checkIn = await tx.checkIn.findUnique({
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

    // closeCycle locks the cycle when claiming its active -> completed update,
    // before it touches check-ins. Follow the same cycle -> check-in lock order
    // here to avoid a response/closure deadlock on the two related rows.
    const lockedCycle = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM follow_up_cycles WHERE id = ${cycle.id}::uuid FOR UPDATE
    `;
    if (lockedCycle.length !== 1) throw notFound('Follow-up cycle not found');

    const criteria = (cycle.recoveryCriteria ?? {}) as DeviationCriteria;
    const evaluation = evaluateDeviation(input.responses, criteria);

    // Compare-and-set, not a read followed by an unconditional update. A
    // concurrent response must not overwrite the first or count its deviation
    // twice. A late answer to a missed check-in remains supported.
    const claimed = await tx.checkIn.updateMany({
      where: { id: checkInId, status: { in: ['scheduled', 'missed'] } },
      data: {
        responses: input.responses as never,
        status: 'responded',
        // A late response needs a fresh review, even if the unanswered check-in was reviewed earlier.
        reviewedAt: null, reviewedById: null, reviewNote: null,
        isDeviation: evaluation.isDeviation,
        deviationReasons: evaluation.reasons as never,
        respondedAt: input.client_created_at ? new Date(input.client_created_at) : new Date(),
        channel: (input.channel ?? 'app') as never,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw conflict('CHECK_IN_ALREADY_ANSWERED', 'This check-in has already been answered');
    }

    if (evaluation.isDeviation) {
      await tx.followUpCycle.update({
        where: { id: cycle.id },
        data: { openDeviationCount: { increment: 1 } },
      });
      // Keep clinical explanations on the protected check-in row. The ledger
      // needs a reference and count, not patient-reported values or free text.
      // Passing tx ensures an audit failure rolls back both preceding writes.
      await appendAudit({
        actorUserId: caller.sub,
        action: 'checkin.deviation_flagged',
        entityType: 'check_ins',
        entityId: checkInId,
        metadata: { cycleId: cycle.id, reasonCount: evaluation.reasons.length },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      }, tx);
    }

    return tx.checkIn.findUniqueOrThrow({ where: { id: checkInId } });
  }, { maxWait: 10_000, timeout: 10_000 });

  return serialiseCheckIn(updated);
}

/**
 * Explicit outcome-recording path for the assigned clinician or platform admin
 * under the existing authorization policy. The scheduler does not close cycles
 * or infer recovery when their scheduling window ends.
 */
export async function closeCycle(
  cycleId: string, caller: Caller, outcome: string, notes: string | undefined, meta: Meta,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const cycle = await tx.followUpCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) throw notFound('Follow-up cycle not found');
    if (cycle.clinicianId !== caller.cpid && caller.role !== 'platform_admin') {
      throw forbidden('NOT_RESOURCE_OWNER', 'Only the assigned clinician may close this cycle');
    }
    if (cycle.status !== 'active') {
      throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'This cycle is already closed');
    }

    // Only one explicit closure can win. A retry cannot replace the clinical
    // outcome committed by another authorized request.
    const closed = await tx.followUpCycle.updateMany({
      where: { id: cycleId, status: 'active' },
      data: { status: 'completed', outcome: outcome as never, version: { increment: 1 } },
    });
    if (closed.count !== 1) {
      throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'This cycle is already closed');
    }

    await tx.careThread.updateMany({
      where: { id: cycle.careThreadId, activeFollowUpCycleId: cycleId },
      data: { activeFollowUpCycleId: null },
    });

    await tx.checkIn.updateMany({
      where: { followUpCycleId: cycleId, status: 'scheduled' },
      data: { status: 'missed' },
    });

    await appendAudit({
      actorUserId: caller.sub, action: 'followup.cycle_closed',
      entityType: 'follow_up_cycles', entityId: cycleId,
      reason: notes ?? null, metadata: { outcome },
      ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);

    return tx.followUpCycle.findUniqueOrThrow({ where: { id: cycleId } });
  }, { maxWait: 10_000, timeout: 10_000 });

  return serialiseCycle(updated);
}


/**
 * The caller's own check-ins across every cycle, newest window first.
 *
 * Scoped the same way /adherence-logs is: a patient (or guardian) sees their
 * own, a clinician sees the cycles they own, an admin sees all. There is no
 * unscoped variant, because "list every check-in on the platform" is not a
 * question anyone using this app needs answered.
 */
export async function listMyCheckIns(
  caller: Caller,
  query: { status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { followUpCycle: { clinicianId: caller.cpid } }
        : { followUpCycle: { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } } };

  const rows = await prisma.checkIn.findMany({
    where: { ...scope, ...(query.status ? { status: query.status as never } : {}) },
    orderBy: { scheduledAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseCheckIn);
}
