import { prisma } from '@a-health/database';
import { forbidden, notFound, conflict } from '@a-health/http';
import type { BillCaller } from './bill.service.js';

export interface PaymentReceipt {
  number: string; billReference: string; title: string; payerName: string;
  amount: number; refundedAmount: number; currency: string; settledAt: Date;
  provider: string; transactionReference: string; environment: string;
}

export async function getBillReceipt(billId: string, caller: BillCaller, enrollment = false): Promise<PaymentReceipt> {
  if (!caller.sub || !['patient', 'platform_admin'].includes(caller.role ?? '')) throw forbidden('ROLE_NOT_PERMITTED', 'Receipt access is unavailable.');
  const actor = await prisma.user.findUnique({ where: { id: caller.sub } });
  if (!actor || actor.role !== caller.role || (enrollment ? actor.status !== 'pending_verification' || !actor.onboardingRequired : actor.status !== 'active')) throw forbidden('ROLE_NOT_PERMITTED', 'Receipt access is unavailable.');
  const bill = await prisma.careBill.findFirst({ where: { id: billId, ...(caller.role === 'platform_admin' && !enrollment ? {} : { payerUserId: caller.sub }) }, include: { payer: true, intents: { select: { id: true } } } });
  if (!bill) throw notFound('Receipt not found.');
  if (enrollment && bill.purpose !== 'registration_fee') throw notFound('Receipt not found.');
  const payment = await prisma.payment.findFirst({ where: {
    paymentIntentId: { in: bill.intents.map(i => i.id) }, payerUserId: bill.payerUserId,
    status: { in: ['succeeded', 'partially_refunded', 'refunded'] }, amount: bill.amount, currency: bill.currency,
  }, orderBy: { settledAt: 'desc' } });
  if (!payment) throw conflict('STATE_TRANSITION_INVALID', 'Risiti itapatikana baada ya malipo kuthibitishwa.');
  return {
    number: `AHP-R-${payment.id.toUpperCase()}`, billReference: bill.reference,
    title: bill.purpose === 'registration_fee' ? 'Ada ya usajili' : bill.title,
    payerName: bill.payer.fullName ?? 'Mlipaji wa A-Health',
    amount: Number(payment.amount), refundedAmount: Number(payment.refundedAmount), currency: payment.currency,
    settledAt: payment.settledAt, provider: payment.provider ?? payment.method,
    transactionReference: payment.providerTransactionId ?? payment.providerReference ?? payment.id,
    environment: payment.environment,
  };
}
