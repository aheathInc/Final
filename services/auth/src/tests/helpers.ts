import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget } from '@a-health/database/test-safety';
import { randomInt } from 'node:crypto';

/**
 * Guard rail. These tests create and delete users, so refusing to run against
 * anything that is not obviously a development or test database is the
 * difference between a red test and a very bad afternoon.
 */
export function assertSafeDatabase(): void {
  assertIsolatedLocalTestTarget(process.env);
}

/** Unique per run, so parallel runs and reruns never collide. */
export function testPhone(): string {
  return `+2557${randomInt(10_000_000, 99_999_999)}`;
}

export const meta = { ip: '127.0.0.1', requestId: 'test' };

/**
 * Reads the code from the explicitly authorized local development/test echo.
 *
 * There is deliberately no way to recover it from the stored hash. An earlier
 * version of this helper tried brute force over the six-digit space. Tests
 * use the same local-only response echo as the development acceptance flow;
 * plaintext console logging and verification bypasses are separate and off.
 */
export function codeOf(challenge: { dev_code?: string }): string {
  if (!challenge.dev_code) {
    throw new Error(
      'No dev_code in the challenge. For local tests, explicitly enable AUTH_LOCAL_OTP_MODE and OTP_ECHO_IN_RESPONSE with the isolated local test target.',
    );
  }
  return challenge.dev_code;
}

export function wrongOtpCode(code: string): string {
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Expected a six-digit OTP from the local test challenge.');
  }
  const firstDigit = code[0] === '0' ? '1' : '0';
  return String(firstDigit) + code.slice(1);
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
