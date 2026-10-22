import { prisma } from '@a-health/database';
import { createTokenService, type AccessTokenClaims } from '@a-health/http';
import { env } from '../config/env.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.INTERNAL_TOKEN_TTL_SECONDS,
});

/**
 * Resolves a phone number to its linked account and mints a normal access
 * token for it — the same shape every other login path produces. This is
 * what "the channel never forks the business rules" means in practice:
 * downstream services see an ordinary authenticated request, not a
 * special-cased USSD bypass.
 *
 * Returns null for an unrecognised or inactive phone. Registering a new
 * account belongs to auth's own OTP flow — reimplementing it here would be
 * the second business-rule path this design exists to prevent.
 */
export async function mintTokenForPhone(phoneNumber: string): Promise<{ token: string; claims: AccessTokenClaims } | null> {
  const user = await prisma.user.findUnique({
    where: { phoneNumber },
    include: { patientProfile: true, clinicianProfile: true },
  });
  if (
    !user ||
    user.status !== 'active' ||
    user.role !== 'patient' ||
    !user.patientProfile
  ) {
    return null;
  }

  const claims: AccessTokenClaims = {
    sub: user.id,
    role: user.role,
    status: user.status,
    ppid: user.patientProfile?.id,
    cpid: user.clinicianProfile?.id,
    vst: user.clinicianProfile?.verificationStatus,
    amr: 'otp',
    jti: `gw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  return { token: tokens.sign(claims), claims };
}
