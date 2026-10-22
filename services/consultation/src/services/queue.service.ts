import { prisma } from '@a-health/database';
import { cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';
import { serialiseConsultation } from './consultation.service.js';
import type { Caller } from './careThread.service.js';

function ageBand(dob: Date | null): string {
  if (!dob) return 'unknown';
  const years = Math.floor((Date.now() - dob.getTime()) / 31557600000);
  if (years < 1) return '<1';
  if (years < 5) return '1-4';
  const decade = Math.floor(years / 10) * 10;
  return decade + '-' + (decade + 9);
}

type ConsultationRow = Parameters<typeof serialiseConsultation>[0] & {
  patient?: { dateOfBirth: Date | null; sex: string | null; chronicConditions: unknown } | null;
};

function entry(
  c: ConsultationRow,
  offeredAt: Date,
  rankScore?: number,
  offer?: { status: string; expiresAt: Date },
) {
  const chronic = c.patient?.chronicConditions;
  return {
    consultation: serialiseConsultation(c),
    // Enough to decide whether to accept. The full history opens only after
    // acceptance — browsing records you have not taken on is not a right.
    patient_summary: {
      age_band: ageBand(c.patient?.dateOfBirth ?? null),
      sex: c.patient?.sex ?? null,
      has_chronic_conditions: Array.isArray(chronic) && chronic.length > 0,
    },
    offered_at: offeredAt.toISOString(),
    seconds_to_sla_breach: Math.round((c.slaDeadlineAt.getTime() - Date.now()) / 1000),
    ...(offer
      ? { offer: { state: offer.status, expires_at: offer.expiresAt.toISOString() } }
      : {}),
    ...(rankScore !== undefined ? { rank_score: rankScore } : {}),
  };
}

/**
 * The clinician's queue, ordered by urgency and then by how close each case is
 * to breaching its SLA — the two things that decide what to pick up next.
 */
export async function getQueue(
  caller: Caller,
  query: { scope: 'offered' | 'mine'; urgency_level?: string; cursor?: string; limit: number },
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  if (query.scope === 'mine') {
    const rows = await prisma.consultationRequest.findMany({
      where: {
        assignedClinicianId: cpid,
        status: { in: ['matched', 'in_progress'] },
        ...(query.urgency_level ? { urgencyLevel: query.urgency_level as never } : {}),
      },
      include: { patient: true },
      orderBy: [{ urgencyLevel: 'desc' }, { slaDeadlineAt: 'asc' }],
      ...cursorArgs(query.cursor, query.limit),
    });
    return toCursorPage(rows, query.limit, (c) => entry(c, c.createdAt));
  }

  const offers = await prisma.consultationOffer.findMany({
    where: { clinicianId: cpid, status: 'offered', expiresAt: { gt: new Date() } },
    include: { consultation: { include: { patient: true } } },
    orderBy: [{ rankScore: 'desc' }, { offeredAt: 'asc' }],
    ...cursorArgs(query.cursor, query.limit),
  });

  const filtered = query.urgency_level
    ? offers.filter((o) => o.consultation.urgencyLevel === query.urgency_level)
    : offers;

  return toCursorPage(filtered, query.limit, (o) =>
    entry(o.consultation, o.offeredAt, Number(o.rankScore), {
      status: o.status,
      expiresAt: o.expiresAt,
    }),
  );
}

/**
 * The patient's own view. Waiting without knowing is the experience this
 * platform exists to remove, so an unexplained wait is not acceptable here
 * either.
 *
 * `estimated_wait_minutes` is null when no honest estimate exists. A fabricated
 * number recreates the original problem in a new form.
 */
export async function getQueueStatus(consultationId: string, caller: Caller) {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    include: {
      patient: true,
      assignedClinician: { include: { user: { select: { fullName: true } } } },
    },
  });
  if (!consultation) throw notFound('Consultation not found');

  const owns =
    consultation.patient.userId === caller.sub ||
    consultation.patient.guardianUserId === caller.sub ||
    caller.role === 'platform_admin' ||
    consultation.assignedClinicianId === caller.cpid;
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This consultation is not yours');

  let position: number | null = null;
  let estimate: number | null = null;

  if (['pending', 'offered', 'escalated'].includes(consultation.status)) {
    const ahead = await prisma.consultationRequest.count({
      where: {
        status: { in: ['pending', 'offered', 'escalated'] },
        urgencyLevel: consultation.urgencyLevel,
        slaDeadlineAt: { lt: consultation.slaDeadlineAt },
      },
    });
    position = ahead + 1;

    const available = await prisma.clinicianProfile.count({
      where: { verificationStatus: 'verified', isAvailable: true, currentLoad: { lt: 5 } },
    });
    // Only estimate when there is something to estimate from. Nobody on duty
    // means no honest number, and null says exactly that.
    estimate = available > 0 ? Math.max(1, Math.round((position / available) * 10)) : null;
  }

  return {
    consultation_id: consultation.id,
    status: consultation.status,
    urgency_level: consultation.urgencyLevel,
    queue_position: position,
    ahead_of_you: position === null ? null : position - 1,
    estimated_wait_minutes: estimate,
    sla_deadline_at: consultation.slaDeadlineAt.toISOString(),
    assigned_clinician_id: consultation.assignedClinicianId ?? consultation.assignedClinician?.id ?? null,
    assigned_clinician: consultation.assignedClinician
      ? {
          full_name: consultation.assignedClinician.user.fullName,
          specialty: consultation.assignedClinician.specialty,
        }
      : null,
  };
}
