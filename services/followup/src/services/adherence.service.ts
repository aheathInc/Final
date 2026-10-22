import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';

import { safeReportTime, ScheduleError } from '../continuity/schedule.js';

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
  if (caller.role === 'clinician' && caller.cpid) {
    const rows = await prisma.patientProfile.findMany({
      where: {
        careThreads: {
          some: {
            OR: [
              { primaryClinicianId: caller.cpid },
              { consultations: { some: { assignedClinicianId: caller.cpid } } },
            ],
          },
        },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
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
      supersededAt: null,
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

/** Patient-reported adherence. Silence is never converted to missed. */
export async function confirmDose(
  adherenceLogId: string, caller: Caller,
  input: { reported_status: string; channel?: string; note?: string; client_created_at?: string; base_version?: number },
  missThreshold: number, meta: Meta,
) {
  if (!['taken', 'missed', 'delayed'].includes(input.reported_status)) throw unprocessable('Choose a supported dose report.');
  let reportedAt: Date;
  try { reportedAt = safeReportTime(input.client_created_at); }
  catch (error) { if (error instanceof ScheduleError) throw unprocessable(error.message); throw error; }
  const updated = await prisma.$transaction(async tx => {
    const found = await tx.adherenceLog.findUnique({ where: { id: adherenceLogId }, select: { prescriptionItemId: true } });
    if (!found) throw notFound('Dose record not found.');
    // Same lock as clinician schedule replacement; no report can attach to a
    // slot while it is being superseded. Refresh state after the lock.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`care-plan:${found.prescriptionItemId}`}, 0))`;
    const row = await tx.adherenceLog.findUniqueOrThrow({ where: { id: adherenceLogId }, include: {
      patient: { select: { userId: true, guardianUserId: true } }, prescription: true,
    } });
    const owns = row.patient.userId === caller.sub || row.patient.guardianUserId === caller.sub;
    if ((!owns || caller.role !== 'patient') && caller.role !== 'platform_admin') throw forbidden('NOT_RESOURCE_OWNER', 'This dose record is not yours.');
    if (row.supersededAt || row.prescription.status === 'discontinued') throw conflict('STATE_TRANSITION_INVALID', 'This dose schedule is no longer active. Reload your care plan.');
    // A byte-equivalent retry returns the recorded result, without new writes.
    if (row.reportedStatus === input.reported_status && row.note === (input.note ?? null) && row.reportedAt) return row;
    if (input.base_version !== undefined && input.base_version !== row.version) throw conflict('VERSION_CONFLICT', 'This report changed. Reload before continuing.');
    if (!['unreported', 'delayed'].includes(row.reportedStatus)) throw conflict('STATE_TRANSITION_INVALID', 'This dose already has a final report. Contact your clinician to correct it.');
    const claim = await tx.adherenceLog.updateMany({ where: { id: row.id, version: row.version, supersededAt: null },
      data: { reportedStatus: input.reported_status as never, reportedAt, note: input.note ?? null,
        channel: (input.channel ?? 'app') as never, version: { increment: 1 } } });
    if (!claim.count) throw conflict('VERSION_CONFLICT', 'This dose changed. Reload before continuing.');
    await appendAudit({ actorUserId: caller.sub, action: 'adherence.reported', entityType: 'adherence_logs', entityId: row.id,
      metadata: { status: input.reported_status }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    if (input.reported_status === 'missed') {
      const recent = await tx.adherenceLog.findMany({ where: { prescriptionItemId: row.prescriptionItemId,
        supersededAt: null, scheduledAt: { lte: row.scheduledAt } }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], take: missThreshold });
      if (recent.length === missThreshold && recent.every(d => d.reportedStatus === 'missed')) {
        await appendAudit({ actorUserId: caller.sub, action: 'adherence.repeated_missed_doses', entityType: 'adherence_logs', entityId: row.id,
          metadata: { prescriptionId: row.prescriptionId, consecutiveMissed: missThreshold }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
      }
    }
    return tx.adherenceLog.findUniqueOrThrow({ where: { id: row.id } });
  }, { maxWait: 10_000, timeout: 10_000 });
  return serialise(updated);
}
