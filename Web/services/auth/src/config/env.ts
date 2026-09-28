import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4001),
  SERVICE_NAME: z.string().default('auth'),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),

  // 15 minutes. Short enough that a revoked clinician cannot keep working for
  // long on a token minted before revocation.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  // 30 days, matching the contract. Rotated on every use.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().default(5),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  PASSWORD_MIN_LENGTH: z.coerce.number().default(12),

  /** How often the retention sweep runs. Zero disables it in this process. */
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().default(60),
  /**
   * Refresh tokens are kept well past expiry on purpose: reuse detection needs
   * the spent token to still be findable. Delete them early and a replayed
   * stolen token returns a bland "invalid" instead of revoking the family.
   */
  REFRESH_RETENTION_DAYS: z.coerce.number().default(60),

  // Development only: return the OTP in the response so you can test without
  // an SMS provider. Refused when NODE_ENV is production.
  OTP_ECHO_IN_RESPONSE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.OTP_ECHO_IN_RESPONSE) {
  throw new Error('OTP_ECHO_IN_RESPONSE cannot be enabled in production.');
}
