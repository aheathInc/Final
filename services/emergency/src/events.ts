import { prisma } from '@a-health/database';
import { createPostgresEventBus, type DomainEvent } from '@a-health/http';
import { env } from './config/env.js';

export const bus = createPostgresEventBus(env.DATABASE_URL);

/** Who should hear about this emergency in realtime: the reporter and the patient. */
export async function audienceFor(emergencyId: string): Promise<string[]> {
  const e = await prisma.emergencyRequest.findUnique({
    where: { id: emergencyId },
    select: {
      reportedByUserId: true,
      patient: { select: { userId: true, guardianUserId: true } },
    },
  });
  if (!e) return [];
  return [e.reportedByUserId, e.patient?.userId, e.patient?.guardianUserId]
    .filter((id): id is string => Boolean(id));
}

export async function publishEmergencyEvent(
  emergencyId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const audienceUserIds = await audienceFor(emergencyId);
    if (audienceUserIds.length === 0) return;
    const event: DomainEvent = {
      event: 'emergency.dispatched',
      entity: 'emergency_requests',
      id: emergencyId,
      audienceUserIds,
      data,
    };
    await bus.publish(event);
  } catch {
    /* best effort — the record is already committed */
  }
}
