import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(4021),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  /** Deliberately short — an internal token minted for one USSD/SMS interaction, not a session. */
  INTERNAL_TOKEN_TTL_SECONDS: z.coerce.number().default(120),

  GATEWAY_SHARED_SECRET: z.string().min(16),

  AUTH_SERVICE_URL: z.string().default('http://localhost:4001'),
  DOCTOR_SERVICE_URL: z.string().default('http://localhost:4003'),
  APPOINTMENT_SERVICE_URL: z.string().default('http://localhost:4004'),
  PAYMENT_SERVICE_URL: z.string().default('http://localhost:4012'),
  USSD_CONTEXT_KEY: z.string().default(''),
  GATEWAY_INBOUND_SMS_ENABLED: z.enum(['true','false']).default('false'),
  CONSULTATION_SERVICE_URL: z.string().default('http://localhost:4005'),
  MESSAGING_SERVICE_URL: z.string().default('http://localhost:4006'),
  FOLLOWUP_SERVICE_URL: z.string().default('http://localhost:4007'),

  USSD_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(300).default(180),
});

const parsed = envSchema.safeParse(process.env);
if(!parsed.success) throw new Error('Gateway configuration invalid; secret values are not shown.');
export const env = parsed.data;

if(env.NODE_ENV==='production'&&!/^[0-9a-fA-F]{64}$/.test(env.USSD_CONTEXT_KEY)) throw new Error('USSD requires a separate 32-byte hexadecimal context-encryption key.');
if(env.NODE_ENV==='production'&&env.GATEWAY_INBOUND_SMS_ENABLED==='true') throw new Error('Inbound SMS clinical writes require a durable authenticated inbox implementation; disabled for production.');
