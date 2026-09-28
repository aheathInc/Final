import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4021),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  /** Deliberately short — an internal token minted for one USSD/SMS interaction, not a session. */
  INTERNAL_TOKEN_TTL_SECONDS: z.coerce.number().default(120),

  GATEWAY_SHARED_SECRET: z.string().min(16),

  CONSULTATION_SERVICE_URL: z.string().default('http://localhost:4005'),
  MESSAGING_SERVICE_URL: z.string().default('http://localhost:4006'),
  FOLLOWUP_SERVICE_URL: z.string().default('http://localhost:4007'),

  USSD_SESSION_TTL_SECONDS: z.coerce.number().default(180),
});

export const env = envSchema.parse(process.env);
