import { prisma } from '@a-health/database';
import { env } from '../config/env.js';

export interface SweepResult {
  otpChallenges: number;
  idempotencyRecords: number;
  refreshTokens: number;
}

/**
 * Deletes rows that have outlived their purpose.
 *
 * Without this, three tables grow forever. otp_challenges gains a row per
 * login attempt across the whole user base; idempotency_records is worse than
 * merely large, because it holds full response bodies — once consultations
 * become idempotent it will contain diagnoses and prescriptions, and an
 * expired copy of a medical record is still a medical record.
 */
export async function sweepExpired(now = new Date()): Promise<SweepResult> {
  // Kept a day past expiry so a support question about a failed sign-in can
  // still be answered.
  const otp = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
  });

  const idem = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  const cutoff = new Date(now.getTime() - env.REFRESH_RETENTION_DAYS * 86_400_000);
  const refresh = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });

  return {
    otpChallenges: otp.count,
    idempotencyRecords: idem.count,
    refreshTokens: refresh.count,
  };
}

/**
 * Runs the sweep on an interval inside the service process.
 *
 * Adequate for one instance. Once auth runs more than one replica this should
 * move to a single scheduled job — several replicas sweeping concurrently is
 * harmless here, but it is wasted work and the pattern does not generalise to
 * jobs that are not idempotent.
 */
export function scheduleSweep(): NodeJS.Timeout | null {
  if (env.CLEANUP_INTERVAL_MINUTES <= 0) return null;
  const run = () => {
    void sweepExpired()
      .then((r) => {
        if (r.otpChallenges + r.idempotencyRecords + r.refreshTokens > 0) {
          console.log('retention sweep', r);
        }
      })
      .catch((e) => console.error('retention sweep failed', e));
  };
  const timer = setInterval(run, env.CLEANUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  return timer;
}
