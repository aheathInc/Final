import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('surveillance.rollup');

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

/**
 * Recomputes SurveillanceRollup for a bounded recent window, from real
 * ConsultationNote.diagnosisCodes joined through to the patient's own
 * regionCode. Deletes and rewrites the window's rollups each run rather than
 * incrementally upserting — idempotent by construction, matching the
 * pattern the followup and consultation SLA workers already use.
 *
 * A note with no regionCode on its patient contributes to the `national`
 * level only, never to a fabricated region — an unknown location is left
 * unknown, not guessed into a district it may not belong to.
 */
export async function computeRollups(now = new Date()): Promise<{ daysProcessed: number; rowsWritten: number }> {
  let rowsWritten = 0;
  const days = env.ROLLUP_WINDOW_DAYS;

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(now.getTime() - offset * 86_400_000);
    const periodStart = startOfDay(day);
    const periodEnd = endOfDay(day);

    const notes = await prisma.consultationNote.findMany({
      where: { signedAt: { gte: periodStart, lte: periodEnd } },
      select: {
        diagnosisCodes: true,
        consultation: { select: { patient: { select: { regionCode: true } } } },
      },
    });

    // regionCode -> conditionCode -> count. 'national' is always populated;
    // a region key is added only when the patient's regionCode is known.
    const counts = new Map<string, Map<string, number>>();
    const bump = (area: string, code: string) => {
      if (!counts.has(area)) counts.set(area, new Map());
      const inner = counts.get(area)!;
      inner.set(code, (inner.get(code) ?? 0) + 1);
    };

    for (const note of notes) {
      const codes = Array.isArray(note.diagnosisCodes) ? (note.diagnosisCodes as string[]) : [];
      const region = note.consultation.patient.regionCode;
      for (const code of codes) {
        bump('national', code);
        if (region) bump(region, code);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.surveillanceRollup.deleteMany({
        where: { periodStart, level: { in: ['national', 'region'] } },
      });

      const rows: {
        level: 'national' | 'region'; areaCode: string; conditionCode: string; conditionName: string;
        periodStart: Date; periodEnd: Date; count: number;
      }[] = [];

      for (const [area, byCode] of counts) {
        const level = area === 'national' ? 'national' : 'region';
        for (const [code, count] of byCode) {
          rows.push({ level, areaCode: area, conditionCode: code, conditionName: code, periodStart, periodEnd, count });
        }
      }

      if (rows.length > 0) {
        await tx.surveillanceRollup.createMany({ data: rows as never });
      }
      rowsWritten += rows.length;
    });
  }

  return { daysProcessed: days, rowsWritten };
}

export function startRollupWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void computeRollups()
      .then((r) => logger.info('rollup tick', r))
      .catch((e) => logger.error('rollup tick failed', { err: String(e) }));
  }, env.ROLLUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  logger.info('rollup worker started', { intervalMinutes: env.ROLLUP_INTERVAL_MINUTES, windowDays: env.ROLLUP_WINDOW_DAYS });
  return timer;
}
