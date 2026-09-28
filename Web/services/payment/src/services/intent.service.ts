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
  // 'processing' is included deliberately: a mobile money intent moves
  // straight there on creation (the provider push happens synchronously),
  // and that is exactly the "waiting on the payer to confirm" window — the
  // one moment cancellation is actually meaningful for mobile money.
  if (intent.status !== 'pending' && intent.status !== 'requires_action' && intent.status !== 'processing') {
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
