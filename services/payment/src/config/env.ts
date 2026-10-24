import dotenv from 'dotenv';
import { z } from 'zod';
import { resolvePaymentSettings } from '../services/policy.js';
dotenv.config();
const schema=z.object({
 NODE_ENV:z.enum(['development','production','test']),PORT:z.coerce.number().default(4012),DATABASE_URL:z.string(),
 JWT_SECRET:z.string().min(32),JWT_ISSUER:z.string().default('a-health'),JWT_AUDIENCE:z.string().default('a-health-api'),
 ACCESS_TOKEN_TTL_SECONDS:z.coerce.number().default(900),IDEMPOTENCY_TTL_HOURS:z.coerce.number().default(24),
 MOBILE_MONEY_PROVIDER:z.enum(['console','flutterwave']).default('console'),
 FLW_SECRET_KEY:z.string().default(''),FLW_WEBHOOK_SECRET:z.string().default(''),
 FLW_ENVIRONMENT:z.enum(['test','live']).default('test'),FLW_WEBHOOK_AUTH:z.enum(['hmac_sha256','verif_hash']).default('verif_hash'),
 PAYMENTS_LIVE_ENABLED:z.enum(['true','false']).default('false'),
 WEBHOOK_SECRET_MPESA:z.string().default(''),WEBHOOK_SECRET_TIGO_PESA:z.string().default(''),WEBHOOK_SECRET_AIRTEL_MONEY:z.string().default(''),
 INTENT_TTL_MINUTES:z.coerce.number().int().min(5).max(60).default(15),
 PAYMENT_RECONCILE_SECONDS:z.coerce.number().int().min(0).max(3600).default(60),
});
const parsed=schema.safeParse(process.env);if(!parsed.success) throw new Error('Payment configuration invalid; values are not shown.');
export const env=parsed.data;
export const paymentSettings=resolvePaymentSettings({...process.env,...Object.fromEntries(Object.entries(env).map(([k,v])=>[k,String(v)]))});
