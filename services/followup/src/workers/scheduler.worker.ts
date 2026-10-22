import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('followup.scheduler');

const INTERVAL_HOURS: Record<string, number> = {
  daily: 24,
  twice_daily: 12,
  weekly: 168,
};

export interface SchedulerResult {
  cyclesProcessed: number;
  checkInsCreated: number;
  cyclesAutoClosed: number;
}

/**
 * Generates due check-ins from active cycles, and closes a cycle whose window
 * has ended cleanly — reached its end date with no unresolved deviation.
 *
 * Idempotent by construction: each pass only creates a check-in for a slot
 * that does not already have one, so running the tick twice in the same
 * window is harmless.
 */
export async function tick(now = new Date()): Promise<SchedulerResult> {
  const cycles = await prisma.followUpCycle.findMany({
    where: { status: 'active' },
    take: 500,
  });

  let checkInsCreated = 0;
  let cyclesAutoClosed = 0;

  for (const cycle of cycles) {
    if (cycle.endDate < now) {
      if (cycle.openDeviationCount === 0) {
        await prisma.$transaction([
          prisma.followUpCycle.update({
            where: { id: cycle.id },
            data: { status: 'completed', outcome: 'recovered', version: { increment: 1 } },
          }),
          prisma.careThread.updateMany({
            where: { id: cycle.careThreadId, activeFollowUpCycleId: cycle.id },
            data: { activeFollowUpCycleId: null },
          }),
        ]);
        cyclesAutoClosed += 1;
      }
      // A cycle past its end date with an open deviation is left active
      // deliberately — a clinical concern that has not been resolved does not
      // get closed by a timer.
      continue;
    }

    const intervalHours =
      cycle.frequency === 'custom' ? 24 : (INTERVAL_HOURS[cycle.frequency] ?? 24);

    const horizon = new Date(now.getTime() + env.SCHEDULE_HORIZON_DAYS * 86400000);
    const existing = await prisma.checkIn.findMany({
      where: { followUpCycleId: cycle.id, scheduledAt: { lte: horizon } },
      select: { scheduledAt: true },
    });
    const existingTimes = new Set(existing.map((e) => e.scheduledAt.getTime()));

    const toCreate: { followUpCycleId: string; careThreadId: string; scheduledAt: Date; questions: unknown }[] = [];
    for (
      let t = cycle.startDate.getTime();
      t <= Math.min(horizon.getTime(), cycle.endDate.getTime());
      t += intervalHours * 3600000
    ) {
      if (t < now.getTime() - 3600000) continue;
      if (existingTimes.has(t)) continue;
      toCreate.push({
        followUpCycleId: cycle.id,
        careThreadId: cycle.careThreadId,
        scheduledAt: new Date(t),
        questions: cycle.questionnaireKey
          ? [{ key: cycle.questionnaireKey }]
          : [{ key: 'general_wellbeing' }],
      });
    }

    if (toCreate.length > 0) {
      await prisma.checkIn.createMany({ data: toCreate as never });
      checkInsCreated += toCreate.length;
    }
  }

  // A check-in nobody answered long enough ago is not still "scheduled" —
  // it is missed, and a missed check-in is itself a signal worth a clinician
  // seeing, not a silently expiring row.
  const missedCutoff = new Date(now.getTime() - env.MISSED_AFTER_HOURS * 3600000);
  const missed = await prisma.checkIn.updateMany({
    where: { status: 'scheduled', scheduledAt: { lt: missedCutoff } },
    data: { status: 'missed' },
  });

  if (missed.count > 0) logger.warn('check-ins marked missed', { count: missed.count });

  return { cyclesProcessed: cycles.length, checkInsCreated, cyclesAutoClosed };
}

export function startScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick()
      .then((r) => {
        if (r.checkInsCreated + r.cyclesAutoClosed > 0) logger.info('scheduler tick', { ...r });
      })
      .catch((e) => logger.error('scheduler tick failed', { err: String(e) }));
  }, env.SCHEDULER_INTERVAL_MINUTES * 60000);
  timer.unref();
  logger.info('scheduler started', { intervalMinutes: env.SCHEDULER_INTERVAL_MINUTES });
  return timer;
}
