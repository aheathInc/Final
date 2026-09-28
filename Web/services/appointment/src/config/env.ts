import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // 4004 was reserved for this service from the very first packages/config
  // SERVICE_PORTS list, between doctor (4003) and consultation (4005).
  PORT: z.coerce.number().default(4004),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** How far ahead of the slot a party may call start(). */
  START_WINDOW_MINUTES: z.coerce.number().default(15),
  SLA_ROUTINE_SECONDS: z.coerce.number().default(7200),
});

export const env = envSchema.parse(process.env);
