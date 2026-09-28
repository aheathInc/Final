import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4012),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** `console` logs instead of calling a real gateway — safe default for dev. */
  MOBILE_MONEY_PROVIDER: z.enum(['console', 'http']).default('console'),
  MOBILE_MONEY_GATEWAY_URL: z.string().default(''),
  MOBILE_MONEY_GATEWAY_KEY: z.string().default(''),

  /** Shared secrets used to verify X-Webhook-Signature, one per provider. */
  WEBHOOK_SECRET_MPESA: z.string().default(''),
  WEBHOOK_SECRET_TIGO_PESA: z.string().default(''),
  WEBHOOK_SECRET_AIRTEL_MONEY: z.string().default(''),

  /** How long a mobile money intent is held before it is swept to failed. */
  INTENT_TTL_MINUTES: z.coerce.number().default(15),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.MOBILE_MONEY_PROVIDER === 'console') {
  throw new Error('MOBILE_MONEY_PROVIDER=console cannot be used in production — nothing would be charged.');
}
