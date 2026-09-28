import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4005),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  // Configurable per deployment, because a rural pilot and a city hospital have
  // different honest answers — but never per request.
  SLA_EMERGENCY_SECONDS: z.coerce.number().default(180),
  SLA_URGENT_SECONDS: z.coerce.number().default(900),
  SLA_ROUTINE_SECONDS: z.coerce.number().default(7200),

  /** How many clinicians a case is offered to at once. */
  OFFER_FANOUT: z.coerce.number().default(3),
  /** How long an offer stands before it lapses. */
  OFFER_TTL_SECONDS: z.coerce.number().default(60),
  /** Concurrent consultations a clinician may hold. */
  MAX_CLINICIAN_LOAD: z.coerce.number().default(5),

  SLA_TICK_SECONDS: z.coerce.number().default(15),
});

export const env = envSchema.parse(process.env);
