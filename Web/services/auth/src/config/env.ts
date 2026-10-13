import dotenv from 'dotenv';
import { z } from 'zod';
import { resolveAuthSecuritySettings } from './security.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
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

  AUTH_LOCAL_OTP_MODE: z.enum(['true', 'false']).default('false'),
  OTP_ECHO_IN_RESPONSE: z.enum(['true', 'false']).default('false'),
  OTP_LOG_TO_CONSOLE: z.enum(['true', 'false']).default('false'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Invalid Auth configuration. Set NODE_ENV explicitly and verify required settings; values are not shown.');
}

const security = resolveAuthSecuritySettings({ ...parsed.data, DATABASE_URL: parsed.data.DATABASE_URL });
if (parsed.data.NODE_ENV === 'production' && /replace|placeholder|change[-_ ]?me|example/i.test(parsed.data.JWT_SECRET)) {
  throw new Error('Invalid Auth configuration: production JWT_SECRET must be a non-placeholder secret.');
}

export const env = { ...parsed.data, ...security };
