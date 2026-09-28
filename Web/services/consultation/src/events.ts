import { prisma } from '@a-health/database';
import { createPostgresEventBus, type DomainEvent } from '@a-health/http';
import { env } from './config/env.js';

export const bus = createPostgresEventBus(env.DATABASE_URL);

/**
 * Who is entitled to hear about a consultation: the patient, their guardian,
 * and the assigned clinician.
 *
 * Worked out here rather than at the delivery end. The service that owns the
 * data is the only one that knows who may hear about it, and computing it in
 * the realtime layer would mean that layer needing read access to every
 * domain it forwards for.
 */
export async function audienceFor(consultationId: string): Promise<string[]> {
  const c = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    select: {
      patient: { select: { userId: true, guardianUserId: true } },
      assignedClinician: { select: { userId: true } },
    },
  });
  if (!c) return [];
  return [
    c.patient.userId,
    c.patient.guardianUserId,
    c.assignedClinician?.userId ?? null,
  ].filter((id): id is string => Boolean(id));
}

/** Best effort. A dropped notification must never fail the write that caused it. */
export async function publishConsultationEvent(
  event: DomainEvent['event'],
  consultationId: string,
  careThreadId: string,
  version: number,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const audienceUserIds = await audienceFor(consultationId);
    if (audienceUserIds.length === 0) return;
    await bus.publish({
      event,
      entity: 'consultation_requests',
      id: consultationId,
      version,
      careThreadId,
      audienceUserIds,
      data,
    });
  } catch {
    /* the record is committed; the nudge is not load-bearing */
  }
}
