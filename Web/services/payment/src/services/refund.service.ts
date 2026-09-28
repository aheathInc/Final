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
