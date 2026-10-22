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
