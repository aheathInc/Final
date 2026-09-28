#!/usr/bin/env bash
#
# Builds services/payment.
#
# Same adapter pattern as services/ai: one interface, swappable providers.
# Swapping M-Pesa for Tigo Pesa, or a stub for a live gateway, is a config
# change plus one new adapter — never a change to the calling code.
#
# Two disciplines carried through from the contract's own design notes:
#   * PaymentIntent and Payment stay separate models. The intent is touched
#     repeatedly while settling; a Payment is written once and only ever
#     gains refunds after that, so a replayed webhook can never mutate money
#     already counted as received.
#   * The webhook is idempotent on the PROVIDER's own transaction reference,
#     never on our internal id — the provider is the one retrying.
#
# Run from the repo root:
#   bash setup-payment-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/payment"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,adapters,types,tests}

# ===========================================================================
# 0. packages/http — the two payment error codes this service actually uses.
#    They were added to the CONTRACT by expand-contract-payment-v2.sh but
#    never synced to packages/http's ErrorCode type — the same drift that
#    bit DISPENSE_CODE_INVALID/DISPENSE_CODE_EXPIRED for pharmacy. Fixed here
#    up front rather than shipping the same bug a third time.
# ===========================================================================
node - "$ROOT/packages/http/src/errors.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const needed = ['PAYMENT_METHOD_UNAVAILABLE', 'PAYMENT_ALREADY_SETTLED'];
const missing = needed.filter((code) => !s.includes(`'${code}'`));

if (missing.length === 0) {
  console.log('  ErrorCode already has the payment codes this service uses');
} else {
  const anchor = "  | 'DUPLICATE_RESOURCE'";
  if (!s.includes(anchor)) { console.error('  ErrorCode anchor not found'); process.exit(1); }
  const lines = missing.map((c) => `  | '${c}'`).join('\n');
  s = s.replace(anchor, `${lines}\n${anchor}`);
  fs.writeFileSync(p, s);
  const onDisk = fs.readFileSync(p, 'utf8');
  const stillMissing = missing.filter((c) => !onDisk.includes(`'${c}'`));
  if (stillMissing.length > 0) {
    console.error('  VERIFY FAILED, still missing:', stillMissing.join(', '));
    process.exit(1);
  }
  console.log(`  ErrorCode: added ${missing.join(', ')}`);
}
NODE

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/payment';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts' };
pkg.dependencies = { ...(pkg.dependencies || {}),
  '@a-health/database': 'workspace:*', '@a-health/http': 'workspace:*',
  '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2', express: '^5.1.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0',
  tsx: '^4.23.5', typescript: '^5.9.3' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > "$SVC/src/config/env.ts" << 'TS'
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
TS

# --- provider adapter interface ---------------------------------------------
cat > "$SVC/src/adapters/provider.ts" << 'TS'
/**
 * The seam every mobile money provider sits behind.
 *
 * Adding Tigo Pesa or Airtel Money — or replacing a stub with the real
 * gateway — is a new adapter implementing this interface, never a change to
 * the calling code in intent.service.ts.
 */

export interface InitiateResult {
  providerReference: string;
  /** What the payer must do next — a USSD prompt, a reference code. Shape varies by provider. */
  clientAction: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly provider: 'mpesa' | 'tigo_pesa' | 'airtel_money';
  initiate(input: { amount: number; currency: string; payerPhone: string; reference: string }): Promise<InitiateResult>;
}

/** Development. Never calls out; the "prompt" is printed, not sent. */
export function createConsoleAdapter(provider: ProviderAdapter['provider']): ProviderAdapter {
  return {
    provider,
    async initiate(input) {
      const reference = `console-${provider}-${Date.now()}`;
      // Phone is masked, amount is not sensitive on its own. No secret ever
      // reaches this log.
      console.log(`[${provider}] would push a payment prompt`, {
        to: input.payerPhone.slice(0, 6) + '****',
        amount: input.amount,
        reference,
      });
      return {
        providerReference: reference,
        clientAction: { type: 'ussd_prompt', message: `Confirm payment of ${input.amount} ${input.currency} on your phone.` },
      };
    },
  };
}
TS

# --- HMAC verification, shared shape for all live providers ------------------
cat > "$SVC/src/services/webhookAuth.ts" << 'TS'
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time HMAC check. A naive `===` comparison leaks timing
 * information about how many leading bytes matched, which is exactly the
 * side channel an attacker forging a settlement callback would use.
 */
export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
TS

# --- payment intent service ---------------------------------------------------
cat > "$SVC/src/services/intent.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';
import type { ProviderAdapter } from '../adapters/provider.js';

export interface Caller { sub?: string; role?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseIntent(i: {
  id: string; amount: unknown; currency: string; method: string; provider: string | null;
  purpose: string; consultationId: string | null; dispensingId: string | null; insuranceClaimId: string | null;
  status: string; providerReference: string | null; clientAction: unknown; paymentId: string | null;
  createdAt: Date; expiresAt: Date | null; version: number;
}) {
  return {
    id: i.id,
    amount: Number(i.amount),
    currency: i.currency,
    method: i.method,
    provider: i.provider,
    purpose: i.purpose,
    consultation_id: i.consultationId,
    dispensing_id: i.dispensingId,
    insurance_claim_id: i.insuranceClaimId,
    status: i.status,
    provider_reference: i.providerReference,
    client_action: i.clientAction ?? null,
    payment_id: i.paymentId,
    created_at: i.createdAt.toISOString(),
    expires_at: i.expiresAt?.toISOString() ?? null,
    version: i.version,
  };
}

/**
 * Creates the intent. Cash and card-on-file settle synchronously here and
 * return `succeeded` immediately, with a Payment created in the same
 * transaction. Mobile money almost never does — it comes back `processing`
 * and settles later, when the provider calls the webhook.
 */
export async function createPaymentIntent(
  caller: Caller,
  input: {
    amount: number; currency: string; method: string; purpose: string;
    consultation_id?: string; dispensing_id?: string; insurance_claim_id?: string;
    payer_phone?: string; return_url?: string;
  },
  adapters: Record<string, ProviderAdapter>,
) {
  if (input.method === 'mobile_money' && !input.payer_phone) {
    throw unprocessable('payer_phone is required for mobile money', 'payer_phone');
  }

  if (input.method === 'cash' || input.method === 'card') {
    // Synchronous settlement path: create the intent first (its own real id),
    // then a Payment that points at it. No placeholder ids anywhere.
    const result = await prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.create({
        data: {
          amount: input.amount,
          currency: input.currency,
          method: input.method as never,
          purpose: input.purpose as never,
          consultationId: input.consultation_id ?? null,
          dispensingId: input.dispensing_id ?? null,
          insuranceClaimId: input.insurance_claim_id ?? null,
          payerUserId: caller.sub ?? null,
          payerPhone: input.payer_phone ?? null,
          status: 'succeeded',
        },
      });
      const payment = await tx.payment.create({
        data: {
          paymentIntentId: intent.id,
          amount: input.amount,
          currency: input.currency,
          method: input.method as never,
          purpose: input.purpose as never,
          consultationId: input.consultation_id ?? null,
          payerUserId: caller.sub ?? null,
          status: 'succeeded',
          settledAt: new Date(),
        },
      });
      const finalIntent = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { paymentId: payment.id, version: { increment: 1 } },
      });
      return finalIntent;
    });

    await appendAudit({
      actorUserId: caller.sub ?? null, action: 'payment.settled_synchronously',
      entityType: 'payment_intents', entityId: result.id,
      metadata: { method: input.method, amount: input.amount },
    });

    return serialiseIntent(result);
  }

  // Mobile money: create pending, then ask the provider to push a prompt.
  const intent = await prisma.paymentIntent.create({
    data: {
      amount: input.amount,
      currency: input.currency,
      method: 'mobile_money',
      purpose: input.purpose as never,
      consultationId: input.consultation_id ?? null,
      dispensingId: input.dispensing_id ?? null,
      insuranceClaimId: input.insurance_claim_id ?? null,
      payerUserId: caller.sub ?? null,
      payerPhone: input.payer_phone ?? null,
      status: 'pending',
      expiresAt: new Date(Date.now() + env.INTENT_TTL_MINUTES * 60_000),
    },
  });

  // Provider selection is deliberately simple for now — the first configured
  // mobile money adapter. A real rollout would route by payer_phone prefix or
  // let the caller choose; that policy lives here, not in the adapters.
  const provider = Object.values(adapters)[0];
  if (!provider) {
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'failed' } });
    throw conflict('PAYMENT_METHOD_UNAVAILABLE', 'No mobile money provider is configured');
  }

  const result = await provider.initiate({
    amount: input.amount, currency: input.currency,
    payerPhone: input.payer_phone!, reference: intent.id,
  });

  const updated = await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: {
      provider: provider.provider,
      status: 'processing',
      providerReference: result.providerReference,
      clientAction: result.clientAction as never,
      version: { increment: 1 },
    },
  });

  await appendAudit({
    actorUserId: caller.sub ?? null, action: 'payment.intent_initiated',
    entityType: 'payment_intents', entityId: intent.id,
    metadata: { provider: provider.provider, amount: input.amount },
  });

  return serialiseIntent(updated);
}

export async function getPaymentIntent(intentId: string, caller: Caller) {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw notFound('Payment intent not found');
  if (intent.payerUserId && intent.payerUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This payment intent is not yours');
  }
  return serialiseIntent(intent);
}

export async function cancelPaymentIntent(intentId: string, caller: Caller, meta: Meta) {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw notFound('Payment intent not found');
  if (intent.payerUserId && intent.payerUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This payment intent is not yours');
  }
  if (intent.status !== 'pending' && intent.status !== 'requires_action') {
    throw conflict('STATE_TRANSITION_INVALID', `Cannot cancel a payment intent in status "${intent.status}"`);
  }

  const updated = await prisma.paymentIntent.update({
    where: { id: intentId },
    data: { status: 'cancelled', version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub ?? null, action: 'payment.intent_cancelled',
    entityType: 'payment_intents', entityId: intentId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseIntent(updated);
}

export async function listPayments(query: { consultation_id?: string; status?: string; cursor?: string; limit: number }) {
  const rows = await prisma.payment.findMany({
    where: {
      ...(query.consultation_id ? { consultationId: query.consultation_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { settledAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, (p) => ({
    id: p.id,
    payment_intent_id: p.paymentIntentId,
    amount: Number(p.amount),
    currency: p.currency,
    method: p.method,
    provider: p.provider,
    provider_reference: p.providerReference,
    purpose: p.purpose,
    consultation_id: p.consultationId,
    payer_user_id: p.payerUserId,
    status: p.status,
    refunded_amount: Number(p.refundedAmount),
    settled_at: p.settledAt.toISOString(),
    version: p.version,
  }));
}
TS

# --- webhook handling -----------------------------------------------------
cat > "$SVC/src/services/webhook.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, unauthenticated } from '@a-health/http';
import { verifyHmacSignature } from './webhookAuth.js';
import { env } from '../config/env.js';

const SECRETS: Record<string, string> = {
  mpesa: env.WEBHOOK_SECRET_MPESA,
  tigo_pesa: env.WEBHOOK_SECRET_TIGO_PESA,
  airtel_money: env.WEBHOOK_SECRET_AIRTEL_MONEY,
};

/**
 * Resolves a settlement callback into a Payment, or records the failure.
 *
 * Idempotent on the PROVIDER's transaction reference, not ours: providers
 * retry webhooks aggressively, and a replay must resolve to exactly the same
 * outcome without crediting a payment twice. The conditional update below
 * (`status: 'processing'` in the where clause) is what makes a second
 * delivery of the same callback a safe no-op rather than a double-settlement.
 */
export async function handleWebhook(
  provider: string,
  rawBody: string,
  signatureHeader: string | undefined,
  payload: { provider_reference?: string; status?: string; failure_reason?: string },
): Promise<{ handled: boolean }> {
  const secret = SECRETS[provider];
  if (!verifyHmacSignature(rawBody, signatureHeader, secret ?? '')) {
    throw unauthenticated('TOKEN_INVALID', 'Webhook signature is not valid');
  }

  const providerReference = payload.provider_reference;
  if (!providerReference) return { handled: false };

  const intent = await prisma.paymentIntent.findUnique({ where: { providerReference } });
  if (!intent) return { handled: false };

  // Already resolved — most likely a retried delivery of a callback we
  // already processed. Acknowledge without touching anything.
  if (intent.status !== 'processing') return { handled: true };

  if (payload.status === 'succeeded') {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          paymentIntentId: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          method: intent.method,
          provider: intent.provider,
          providerReference: intent.providerReference,
          purpose: intent.purpose,
          consultationId: intent.consultationId,
          payerUserId: intent.payerUserId,
          status: 'succeeded',
          settledAt: new Date(),
        },
      });

      // Conditional on still being 'processing' — the guard against a
      // concurrent duplicate delivery landing here at the same moment.
      const updated = await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: 'processing' },
        data: { status: 'succeeded', paymentId: payment.id, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        // Lost the race — someone else's callback settled it first. Undo
        // this Payment rather than leaving two for one intent.
        await tx.payment.delete({ where: { id: payment.id } });
        return null;
      }
      return payment;
    });

    if (result) {
      await appendAudit({
        action: 'payment.webhook_settled',
        entityType: 'payment_intents', entityId: intent.id,
        metadata: { provider, providerReference },
      });
    }
    return { handled: true };
  }

  await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: 'processing' },
    data: { status: 'failed', version: { increment: 1 } },
  });
  await appendAudit({
    action: 'payment.webhook_failed',
    entityType: 'payment_intents', entityId: intent.id,
    metadata: { provider, providerReference, reason: payload.failure_reason ?? null },
  });
  return { handled: true };
}
TS

# --- refund service ---------------------------------------------------------
cat > "$SVC/src/services/refund.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, unprocessable } from '@a-health/http';

export interface Caller { sub?: string; role?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

/**
 * A partial refund may be issued more than once against the same payment; the
 * running total in `refundedAmount` is what stops the sum ever exceeding what
 * was actually paid.
 */
export async function refundPayment(
  paymentId: string, caller: Caller,
  input: { amount?: number; reason: string }, meta: Meta,
) {
  if (caller.role !== 'platform_admin' && caller.role !== 'facility_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only finance staff may issue a refund');
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw conflict('PAYMENT_ALREADY_SETTLED', 'This payment is not in a refundable state');
  }

  const remaining = Number(payment.amount) - Number(payment.refundedAmount);
  const amount = input.amount ?? remaining;
  if (amount <= 0 || amount > remaining) {
    throw unprocessable('Refund amount exceeds what remains on this payment', 'amount');
  }

  const result = await prisma.$transaction(async (tx) => {
    const refund = await tx.paymentRefund.create({
      data: { paymentId, amount, reason: input.reason, issuedById: caller.sub ?? null },
    });

    const newRefunded = Number(payment.refundedAmount) + amount;
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        refundedAmount: newRefunded,
        status: newRefunded >= Number(payment.amount) ? 'refunded' : 'partially_refunded',
        version: { increment: 1 },
      },
    });

    return refund;
  });

  await appendAudit({
    actorUserId: caller.sub ?? null, action: 'payment.refunded',
    entityType: 'payments', entityId: paymentId,
    reason: input.reason, metadata: { amount },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return {
    id: result.id,
    payment_id: result.paymentId,
    amount: Number(result.amount),
    reason: result.reason,
    issued_by_id: result.issuedById,
    provider_reference: result.providerReference,
    created_at: result.createdAt.toISOString(),
  };
}
TS

# --- types --------------------------------------------------------------------
cat > "$SVC/src/types/payment.types.ts" << 'TS'
import { z } from 'zod';

export const createIntentSchema = z.object({
  amount: z.number().min(1),
  currency: z.string().length(3).default('TZS'),
  method: z.enum(['mobile_money', 'card', 'cash', 'insurance']),
  purpose: z.enum(['consultation_fee', 'pharmacy_purchase', 'insurance_copay', 'subscription', 'other']),
  consultation_id: z.string().uuid().optional(),
  dispensing_id: z.string().uuid().optional(),
  insurance_claim_id: z.string().uuid().optional(),
  payer_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  return_url: z.string().url().optional(),
});

export const listPaymentsQuery = z.object({
  consultation_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const refundSchema = z.object({
  amount: z.number().min(0.01).optional(),
  reason: z.string().min(1).max(500),
});

export const webhookProviderParam = z.enum(['mpesa', 'tigo_pesa', 'airtel_money', 'card_gateway', 'manual']);
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/controllers/payment.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { badRequest, pathParam } from '@a-health/http';
import * as intents from '../services/intent.service.js';
import * as refunds from '../services/refund.service.js';
import { handleWebhook } from '../services/webhook.service.js';
import { createConsoleAdapter, type ProviderAdapter } from '../adapters/provider.js';
import { env } from '../config/env.js';
import {
  createIntentSchema, listPaymentsQuery, refundSchema, webhookProviderParam,
} from '../types/payment.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

// Resolved once at startup. Real deployments would register one adapter per
// enabled provider here; the console adapter is the safe default for dev.
const adapters: Record<string, ProviderAdapter> =
  env.MOBILE_MONEY_PROVIDER === 'console' ? { mpesa: createConsoleAdapter('mpesa') } : {};

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createIntent = handle(
  (req) => intents.createPaymentIntent(caller(req), createIntentSchema.parse(req.body), adapters), 201,
);

export const getIntent = handle((req) =>
  intents.getPaymentIntent(pathParam(req, 'payment_intent_id'), caller(req)));

export const cancelIntent = handle((req, res) =>
  intents.cancelPaymentIntent(pathParam(req, 'payment_intent_id'), caller(req), meta(req, res)));

export const listPayments = handle((req) => intents.listPayments(listPaymentsQuery.parse(req.query)));

export const refund = handle(
  (req, res) => refunds.refundPayment(pathParam(req, 'payment_id'), caller(req), refundSchema.parse(req.body), meta(req, res)), 201,
);

/**
 * Raw body is required here, not parsed JSON — the HMAC is computed over the
 * exact bytes the provider sent, and re-serialising a parsed object is not
 * guaranteed to reproduce that byte-for-byte.
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const provider = webhookProviderParam.parse(pathParam(req, 'provider'));
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      throw badRequest('VALIDATION_FAILED', 'Raw body was not captured for signature verification');
    }
    const signature = req.header('X-Webhook-Signature');
    await handleWebhook(provider, rawBody, signature, req.body as Record<string, unknown>);
    res.status(200).json({ acknowledged: true });
  } catch (err) {
    next(err);
  }
}
TS

cat > "$SVC/src/routes/payment.routes.ts" << 'TS'
import { Router, raw as rawBodyParser } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/payment.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const paymentRouter = Router();

paymentRouter.post('/payments/intents', requireAuth, idempotency, c.createIntent);
paymentRouter.get('/payments/intents/:payment_intent_id', requireAuth, c.getIntent);
paymentRouter.post('/payments/intents/:payment_intent_id/cancel', requireAuth, idempotency, c.cancelIntent);

paymentRouter.get('/payments', requireAuth, c.listPayments);
paymentRouter.post('/payments/:payment_id/refund', requireAuth, idempotency, c.refund);

// Captures the exact raw bytes before Express's normal JSON parser would
// otherwise consume and re-serialise the body — the HMAC has to be computed
// over precisely what the provider sent.
paymentRouter.post(
  '/payments/webhooks/:provider',
  rawBodyParser({ type: '*/*' }),
  (req, _res, next) => {
    (req as typeof req & { rawBody: string }).rawBody = req.body.toString('utf8');
    try {
      req.body = JSON.parse((req as typeof req & { rawBody: string }).rawBody || '{}');
    } catch {
      req.body = {};
    }
    next();
  },
  c.webhook,
);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { paymentRouter } from './routes/payment.routes.js';

const service = createService({
  name: 'payment',
  port: env.PORT,
  routers: [paymentRouter],
  development: env.NODE_ENV === 'development',
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4012"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "MOBILE_MONEY_PROVIDER=console"
    echo "WEBHOOK_SECRET_MPESA=test-secret-mpesa"
    echo "WEBHOOK_SECRET_TIGO_PESA=test-secret-tigo"
    echo "WEBHOOK_SECRET_AIRTEL_MONEY=test-secret-airtel"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/payment.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID, createHmac } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as intents from '../services/intent.service.js';
import * as refunds from '../services/refund.service.js';
import { handleWebhook } from '../services/webhook.service.js';
import { verifyHmacSignature } from '../services/webhookAuth.js';
import { createConsoleAdapter, type ProviderAdapter } from '../adapters/provider.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const intentIds: string[] = [];

after(async () => {
  for (const id of intentIds) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id } }).catch(() => null);
    if (intent?.paymentId) {
      await prisma.paymentRefund.deleteMany({ where: { paymentId: intent.paymentId } }).catch(() => undefined);
      await prisma.paymentIntent.update({ where: { id }, data: { paymentId: null } }).catch(() => undefined);
      await prisma.payment.delete({ where: { id: intent.paymentId } }).catch(() => undefined);
    }
    await prisma.paymentIntent.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeUser() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Payment Test' },
  });
  users.push(user.id);
  return user;
}

const mpesaStub: Record<string, ProviderAdapter> = { mpesa: createConsoleAdapter('mpesa') };

describe('cash and card settle synchronously', () => {
  it('creates a succeeded intent and a matching Payment in one step', async () => {
    const user = await makeUser();
    const result = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 5000, currency: 'TZS', method: 'cash', purpose: 'consultation_fee' },
      {},
    );
    intentIds.push(result.id);
    assert.equal(result.status, 'succeeded');
    assert.ok(result.payment_id);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.payment_id! } });
    assert.equal(Number(payment.amount), 5000);
    assert.equal(payment.status, 'succeeded');
  });
});

describe('mobile money', () => {
  it('requires a payer phone', async () => {
    const user = await makeUser();
    await assert.rejects(
      () => intents.createPaymentIntent(
        { sub: user.id, role: 'patient' },
        { amount: 3000, currency: 'TZS', method: 'mobile_money', purpose: 'pharmacy_purchase' },
        mpesaStub,
      ),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('goes to processing with a client action while waiting for the provider', async () => {
    const user = await makeUser();
    const result = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 3000, currency: 'TZS', method: 'mobile_money', purpose: 'pharmacy_purchase', payer_phone: '+255712345678' },
      mpesaStub,
    );
    intentIds.push(result.id);
    assert.equal(result.status, 'processing');
    assert.ok(result.provider_reference);
    assert.ok(result.client_action);
  });

  it('fails cleanly when no provider is configured', async () => {
    const user = await makeUser();
    await assert.rejects(
      () => intents.createPaymentIntent(
        { sub: user.id, role: 'patient' },
        { amount: 1000, currency: 'TZS', method: 'mobile_money', purpose: 'other', payer_phone: '+255712345678' },
        {},
      ),
      (e: AppError) => e.code === 'PAYMENT_METHOD_UNAVAILABLE',
    );
  });
});

describe('cancellation', () => {
  it('cancels a pending mobile money intent', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 2000, currency: 'TZS', method: 'mobile_money', purpose: 'other', payer_phone: '+255712345678' },
      mpesaStub,
    );
    intentIds.push(created.id);
    const cancelled = await intents.cancelPaymentIntent(created.id, { sub: user.id, role: 'patient' }, meta);
    assert.equal(cancelled.status, 'cancelled');
  });

  it('refuses to cancel an already-settled intent', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 2000, currency: 'TZS', method: 'cash', purpose: 'other' },
      {},
    );
    intentIds.push(created.id);
    await assert.rejects(
      () => intents.cancelPaymentIntent(created.id, { sub: user.id, role: 'patient' }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('webhook signature', () => {
  it('verifies a correctly signed payload', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ status: 'succeeded', provider_reference: 'x' });
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    assert.equal(verifyHmacSignature(body, sig, secret), true);
  });

  it('rejects a tampered payload', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ status: 'succeeded', provider_reference: 'x' });
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    assert.equal(verifyHmacSignature(body + 'tampered', sig, secret), false);
  });

  it('rejects a missing signature', () => {
    assert.equal(verifyHmacSignature('{}', undefined, 'secret'), false);
  });
});

describe('webhook settlement', () => {
  const secret = 'itest-mpesa-secret';
  const originalSecret = process.env.WEBHOOK_SECRET_MPESA;

  it('settles a processing intent into a Payment', async () => {
    process.env.WEBHOOK_SECRET_MPESA = secret;
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 4000, currency: 'TZS', method: 'mobile_money', purpose: 'consultation_fee', payer_phone: '+255712345678' },
      mpesaStub,
    );
    intentIds.push(created.id);

    const payload = { provider_reference: created.provider_reference, status: 'succeeded' };
    const body = JSON.stringify(payload);
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    const { handled } = await handleWebhook('mpesa', body, sig, payload);
    assert.equal(handled, true);

    const reloaded = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reloaded.status, 'succeeded');
    assert.ok(reloaded.paymentId);
    process.env.WEBHOOK_SECRET_MPESA = originalSecret;
  });

  it('rejects a webhook with a bad signature', async () => {
    await assert.rejects(
      () => handleWebhook('mpesa', '{}', 'wrong-signature', { provider_reference: 'nope', status: 'succeeded' }),
      (e: AppError) => e.code === 'TOKEN_INVALID',
    );
  });
});

describe('refunds', () => {
  it('refunds the full amount by default and marks refunded', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 6000, currency: 'TZS', method: 'cash', purpose: 'consultation_fee' },
      {},
    );
    intentIds.push(created.id);

    const refund = await refunds.refundPayment(
      created.payment_id!, { sub: randomUUID(), role: 'platform_admin' }, { reason: 'Patient did not receive service' }, meta,
    );
    assert.equal(refund.amount, 6000);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.payment_id! } });
    assert.equal(payment.status, 'refunded');
  });

  it('allows a second partial refund and marks partially_refunded first', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 10000, currency: 'TZS', method: 'cash', purpose: 'consultation_fee' },
      {},
    );
    intentIds.push(created.id);

    await refunds.refundPayment(created.payment_id!, { sub: randomUUID(), role: 'platform_admin' }, { amount: 3000, reason: 'partial' }, meta);
    const midway = await prisma.payment.findUniqueOrThrow({ where: { id: created.payment_id! } });
    assert.equal(midway.status, 'partially_refunded');

    await refunds.refundPayment(created.payment_id!, { sub: randomUUID(), role: 'platform_admin' }, { amount: 7000, reason: 'remainder' }, meta);
    const final = await prisma.payment.findUniqueOrThrow({ where: { id: created.payment_id! } });
    assert.equal(final.status, 'refunded');
  });

  it('refuses a refund exceeding what remains', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 1000, currency: 'TZS', method: 'cash', purpose: 'other' },
      {},
    );
    intentIds.push(created.id);
    await assert.rejects(
      () => refunds.refundPayment(created.payment_id!, { sub: randomUUID(), role: 'platform_admin' }, { amount: 5000, reason: 'too much' }, meta),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('refuses a refund from a non-finance role', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 1000, currency: 'TZS', method: 'cash', purpose: 'other' },
      {},
    );
    intentIds.push(created.id);
    await assert.rejects(
      () => refunds.refundPayment(created.payment_id!, { sub: randomUUID(), role: 'patient' }, { reason: 'trying' }, meta),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/payment exec tsc --noEmit"
echo "  pnpm --filter @a-health/payment test"
