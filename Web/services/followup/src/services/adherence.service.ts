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
