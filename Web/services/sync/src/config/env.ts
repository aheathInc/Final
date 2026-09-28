import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4022),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),

  CONSULTATION_SERVICE_URL: z.string().default('http://localhost:4005'),
  MESSAGING_SERVICE_URL: z.string().default('http://localhost:4006'),
  FOLLOWUP_SERVICE_URL: z.string().default('http://localhost:4007'),
  APPOINTMENT_SERVICE_URL: z.string().default('http://localhost:4004'),

  /** A first sync (no cursor) excludes closed threads older than this. */
  SNAPSHOT_WINDOW_DAYS: z.coerce.number().default(90),
});

export const env = envSchema.parse(process.env);
