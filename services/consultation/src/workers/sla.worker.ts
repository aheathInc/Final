import { prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
import { offerConsultation } from '../services/consultation.service.js';
import { publishConsultationEvent } from '../events.js';

const logger = createLogger('consultation.sla');

/**
 * Turns the response promise into something a machine keeps.
 *
 * "Quick pick and answer" is marketing until a timer enforces it. Each tick
 * does two things: lapse offers nobody acted on, and escalate cases past their
 * deadline — widening the pool each time rather than lowering the bar on who
 * is eligible.
 */
export async function tick(now = new Date()): Promise<{ lapsed: number; escalated: number }> {
  const expiring = await prisma.consultationOffer.findMany({
    where: { status: 'offered', expiresAt: { lt: now } },
    distinct: ['consultationId'],
    select: { consultationId: true },
  });
  let lapsed = 0;
  for (const { consultationId } of expiring) {
    lapsed += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${consultationId}, 0))::text AS locked`;
      const result = await tx.consultationOffer.updateMany({
        where: { consultationId, status: 'offered', expiresAt: { lt: now } },
        data: { status: 'expired', respondedAt: now, version: { increment: 1 } },
      });
      const actionable = await tx.consultationOffer.count({
        where: { consultationId, status: 'offered', expiresAt: { gt: now } },
      });
      if (actionable === 0) {
        await tx.consultationRequest.updateMany({
          where: { id: consultationId, assignedClinicianId: null, status: 'offered' },
          data: { status: 'pending', version: { increment: 1 } },
        });
      }
      return result.count;
    }, { maxWait: 10_000, timeout: 15_000 });
  }

  const breached = await prisma.consultationRequest.findMany({
    where: {
      status: { in: ['pending', 'offered'] },
      assignedClinicianId: null,
      slaDeadlineAt: { lt: now },
    },
    orderBy: [{ urgencyLevel: 'desc' }, { slaDeadlineAt: 'asc' }],
    take: 100,
  });

  for (const consultation of breached) {
    const escalationCount = consultation.escalationCount + 1;

    // The deadline moves so the case is not re-escalated every tick, but the
    // count keeps climbing — a case on its fifth escalation is visible as
    // exactly that on the dispatcher board.
    const escalated = await prisma.consultationRequest.updateMany({
      where: {
        id: consultation.id,
        version: consultation.version,
        assignedClinicianId: null,
        status: { in: ['pending', 'offered'] },
        slaDeadlineAt: { lt: now },
      },
      data: {
        status: 'escalated',
        escalationCount,
        slaDeadlineAt: new Date(now.getTime() + 300000),
        version: { increment: 1 },
      },
    });
    if (escalated.count !== 1) continue;

    await appendAudit({
      action: 'consultation.sla_breached',
      entityType: 'consultation_requests',
      entityId: consultation.id,
      metadata: {
        urgency: consultation.urgencyLevel,
        escalationCount,
        overdueSeconds: Math.round((now.getTime() - consultation.slaDeadlineAt.getTime()) / 1000),
      },
    });

    await publishConsultationEvent(
      'consultation.escalated', consultation.id, consultation.careThreadId,
      consultation.version + 1, { escalationCount },
    );

    logger.warn('sla breached', {
      consultationId: consultation.id,
      urgency: consultation.urgencyLevel,
      escalationCount,
    });

    await offerConsultation(consultation.id).catch((e) =>
      logger.error('re-offer failed', { consultationId: consultation.id, err: String(e) }),
    );
  }

  return { lapsed, escalated: breached.length };
}

export function startSlaWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick().catch((e) => logger.error('sla tick failed', { err: String(e) }));
  }, env.SLA_TICK_SECONDS * 1000);
  timer.unref();
  logger.info('sla worker started', { intervalSeconds: env.SLA_TICK_SECONDS });
  return timer;
}
