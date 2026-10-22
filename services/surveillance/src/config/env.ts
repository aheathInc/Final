import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4020),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  ROLLUP_INTERVAL_MINUTES: z.coerce.number().default(60),
  /** How many days back each tick recomputes. Idempotent recompute of a bounded window, not an ever-growing incremental patch. */
  ROLLUP_WINDOW_DAYS: z.coerce.number().default(7),
});

export const env = envSchema.parse(process.env);
