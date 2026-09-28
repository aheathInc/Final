import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4006),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  /** Ticket lifetime. Long enough to open a socket, short enough to be useless in a log. */
  REALTIME_TICKET_TTL_SECONDS: z.coerce.number().default(60),
  /** Sockets are closed if a pong is not seen within this window. */
  WS_HEARTBEAT_SECONDS: z.coerce.number().default(30),
  PUBLIC_WS_URL: z.string().default('ws://localhost:4006/realtime'),
});

export const env = envSchema.parse(process.env);
