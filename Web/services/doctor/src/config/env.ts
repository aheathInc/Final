import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4003),

  DATABASE_URL: z.string(),

  // This service only verifies tokens; it never mints one. Sharing the secret
  // is what HS256 costs — see the RS256 note in packages/http/src/tokens.ts.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Longest slot a clinician may publish. Guards against a fat-finger 8h slot. */
  MAX_SLOT_MINUTES: z.coerce.number().default(120),
  /** How far ahead slots may be published. */
  MAX_SLOT_HORIZON_DAYS: z.coerce.number().default(90),
});

export const env = envSchema.parse(process.env);
