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
  const lapsed = await prisma.consultationOffer.updateMany({
    where: { status: 'offered', expiresAt: { lt: now } },
    data: { status: 'expired', respondedAt: now },
  });

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
    await prisma.consultationRequest.update({
      where: { id: consultation.id },
      data: {
        status: 'escalated',
        escalationCount,
        slaDeadlineAt: new Date(now.getTime() + 300000),
        version: { increment: 1 },
      },
    });

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

  return { lapsed: lapsed.count, escalated: breached.length };
}

export function startSlaWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick().catch((e) => logger.error('sla tick failed', { err: String(e) }));
  }, env.SLA_TICK_SECONDS * 1000);
  timer.unref();
  logger.info('sla worker started', { intervalSeconds: env.SLA_TICK_SECONDS });
  return timer;
}
