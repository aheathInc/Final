import { prisma } from '@a-health/database';
import { conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller {
  sub: string;
  role: string;
  ppid?: string;
  cpid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}

export function serialiseThread(t: {
  id: string;
  patientProfileId: string;
  primaryClinicianId: string | null;
  status: string;
  reasonSummary: string | null;
  latestConsultationId: string | null;
  openConsultationCount: number;
  activeFollowUpCycleId: string | null;
  outcome: string | null;
  openedAt: Date;
  closedAt: Date | null;
  version: number;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    patient_profile_id: t.patientProfileId,
    primary_clinician_id: t.primaryClinicianId,
    status: t.status,
    reason_summary: t.reasonSummary,
    latest_consultation_id: t.latestConsultationId,
    open_consultation_count: t.openConsultationCount,
    active_follow_up_cycle_id: t.activeFollowUpCycleId,
    outcome: t.outcome,
    opened_at: t.openedAt.toISOString(),
    closed_at: t.closedAt?.toISOString() ?? null,
    version: t.version,
    updated_at: t.updatedAt.toISOString(),
  };
}

/**
 * Visibility. A patient sees their own threads and their dependants'; a
 * clinician sees threads they are primary on or have worked a consultation in;
 * an admin sees everything, and every admin read is audited.
 */
async function visibilityFilter(caller: Caller) {
  if (caller.role === 'platform_admin') return {};
  if (caller.role === 'clinician' && caller.cpid) {
    return {
      OR: [
        { primaryClinicianId: caller.cpid },
        { consultations: { some: { assignedClinicianId: caller.cpid } } },
      ],
    };
  }
  const guarded = await prisma.patientProfile.findMany({
    where: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] },
    select: { id: true },
  });
  return { patientProfileId: { in: guarded.map((g) => g.id) } };
}

export async function listCareThreads(
  caller: Caller,
  query: { patient_id?: string; status?: string; cursor?: string; limit: number },
) {
  const rows = await prisma.careThread.findMany({
    where: {
      ...(await visibilityFilter(caller)),
      ...(query.patient_id ? { patientProfileId: query.patient_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseThread);
}

/**
 * The view a clinician opens when a patient reappears months later: the thread
 * plus everything attached to it, in order. This is the whole reason the care
 * thread exists rather than a pile of unrelated encounters.
 */
export async function getCareThreadDetail(threadId: string, caller: Caller) {
  const thread = await prisma.careThread.findFirst({
    where: { id: threadId, ...(await visibilityFilter(caller)) },
    include: { patient: true },
  });
  if (!thread) throw notFound('Care thread not found');

  const [consultations, notes, messages, checkIns, prescriptions] = await Promise.all([
    prisma.consultationRequest.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' } }),
    prisma.consultationNote.findMany({ where: { careThreadId: threadId }, orderBy: { signedAt: 'asc' } }),
    prisma.message.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' }, take: 500 }),
    prisma.checkIn.findMany({ where: { careThreadId: threadId }, orderBy: { scheduledAt: 'asc' } }),
    prisma.prescription.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' } }),
  ]);

  const timeline: { entry_type: string; id: string; occurred_at: Date; summary: string }[] = [
    ...consultations.map((c) => ({ entry_type: 'consultation', id: c.id, occurred_at: c.createdAt, summary: c.urgencyLevel + ' consultation (' + c.status + ')' })),
    ...notes.map((n) => ({ entry_type: 'note', id: n.id, occurred_at: n.signedAt, summary: n.diagnosisText.slice(0, 160) })),
    ...prescriptions.map((p) => ({ entry_type: 'prescription', id: p.id, occurred_at: p.createdAt, summary: 'prescription (' + p.status + ')' })),
    ...checkIns.map((c) => ({ entry_type: c.isDeviation ? 'deviation' : 'check_in', id: c.id, occurred_at: c.scheduledAt, summary: c.isDeviation ? 'deviation flagged' : 'check-in (' + c.status + ')' })),
    ...messages.map((m) => ({ entry_type: 'message', id: m.id, occurred_at: m.createdAt, summary: (m.body ?? '[attachment]').slice(0, 160) })),
  ].sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());

  return {
    ...serialiseThread(thread),
    patient: {
      id: thread.patient.id,
      full_name: thread.patient.fullName,
      date_of_birth: thread.patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sex: thread.patient.sex,
      chronic_conditions: thread.patient.chronicConditions,
      allergies: thread.patient.allergies,
    },
    timeline: timeline.map((e) => ({ ...e, occurred_at: e.occurred_at.toISOString() })),
  };
}

export async function closeCareThread(
  threadId: string,
  caller: Caller,
  outcome: string,
  notes: string | undefined,
) {
  if (caller.role !== 'clinician' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician may close a care thread');
  }
  const thread = await prisma.careThread.findUnique({ where: { id: threadId } });
  if (!thread) throw notFound('Care thread not found');
  if (thread.status === 'closed') throw conflict('CARE_THREAD_CLOSED', 'Thread is already closed');

  const open = await prisma.consultationRequest.count({
    where: {
      careThreadId: threadId,
      status: { in: ['pending', 'offered', 'matched', 'in_progress', 'escalated'] },
    },
  });
  if (open > 0) {
    throw conflict('STATE_TRANSITION_INVALID', 'Close the open consultations on this thread first');
  }

  const updated = await prisma.careThread.update({
    where: { id: threadId },
    data: {
      status: 'closed',
      outcome: outcome as never,
      outcomeNotes: notes ?? null,
      closedAt: new Date(),
      version: { increment: 1 },
    },
  });
  return serialiseThread(updated);
}
