import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialise(r: { id: string; consultationId: string; clinicianId: string; score: number; comment: string | null; createdAt: Date }) {
  return {
    id: r.id,
    consultation_id: r.consultationId,
    clinician_id: r.clinicianId,
    score: r.score,
    comment: r.comment,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * One rating per consultation, from the patient it belongs to. Feeds the
 * clinician's average, which is one input among several to routing — not
 * the only one, because ranking purely on rating pushes difficult cases
 * away from the people best able to handle them.
 */
export async function rateConsultation(
  consultationId: string, caller: Caller, input: { score: number; comment?: string }, meta: Meta,
) {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    include: { patient: { select: { userId: true, guardianUserId: true } } },
  });
  if (!consultation) throw notFound('Consultation not found');

  const owns = consultation.patient.userId === caller.sub || consultation.patient.guardianUserId === caller.sub;
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'You cannot rate this consultation');
  if (consultation.status !== 'completed') {
    throw conflict('STATE_TRANSITION_INVALID', 'Only completed consultations can be rated');
  }
  if (!consultation.assignedClinicianId) {
    throw conflict('STATE_TRANSITION_INVALID', 'This consultation has no assigned clinician to rate');
  }

  const existing = await prisma.consultationRating.findUnique({ where: { consultationId } });
  if (existing) throw conflict('ALREADY_RATED', 'This consultation has already been rated');

  const clinicianId = consultation.assignedClinicianId;

  const rating = await prisma.$transaction(async (tx) => {
    const created = await tx.consultationRating.create({
      data: { consultationId, clinicianId, score: input.score, comment: input.comment ?? null },
    });

    // Recomputed from the full set rather than incrementally averaged, so a
    // rounding drift can never accumulate across thousands of ratings.
    const agg = await tx.consultationRating.aggregate({
      where: { clinicianId },
      _avg: { score: true },
    });
    await tx.clinicianProfile.update({
      where: { id: clinicianId },
      data: { ratingAvg: agg._avg.score ?? null, version: { increment: 1 } },
    });

    return created;
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.rated',
    entityType: 'consultation_ratings', entityId: rating.id,
    metadata: { consultationId, clinicianId, score: input.score },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(rating);
}
