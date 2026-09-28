import { prisma } from '@a-health/database';
import { randomInt } from 'node:crypto';

/**
 * Guard rail. These tests create and delete users, so refusing to run against
 * anything that is not obviously a development or test database is the
 * difference between a red test and a very bad afternoon.
 */
export function assertSafeDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_dev|_test|localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run tests against ${url}`);
  }
}

/** Unique per run, so parallel runs and reruns never collide. */
export function testPhone(): string {
  return `+2557${randomInt(10_000_000, 99_999_999)}`;
}

export const meta = { ip: '127.0.0.1', requestId: 'test' };

/**
 * Reads the code out of the challenge response.
 *
 * There is deliberately no way to recover it from the stored hash. An earlier
 * version of this helper tried brute force over the six-digit space, which is
 * roughly eight hours at bcrypt cost 12 — the cost factor doing exactly what
 * it is there to do. Tests read the code the same way a developer does, from
 * the dev echo.
 */
export function codeOf(challenge: { dev_code?: string }): string {
  if (!challenge.dev_code) {
    throw new Error(
      'No dev_code in the challenge. Set OTP_ECHO_IN_RESPONSE=true in services/auth/.env to run these tests.',
    );
  }
  return challenge.dev_code;
}

/** Removes everything a test created, in FK-safe order. */
export async function cleanupPhone(phone: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { phoneNumber: phone },
    include: { patientProfile: true, clinicianProfile: true },
  });
  await prisma.otpChallenge.deleteMany({ where: { phoneNumber: phone } });
  if (!user) return;
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.idempotencyRecord.deleteMany({ where: { userId: user.id } });
  if (user.patientProfile) {
    await prisma.changeLog.deleteMany({ where: { patientProfileId: user.patientProfile.id } });
  }
  await prisma.user.delete({ where: { id: user.id } });
}
