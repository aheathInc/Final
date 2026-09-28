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
import { env } from '../config/env.js';

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
  // env.ts parses process.env into a frozen object once, at module import
  // time. Mutating process.env after that point (as a previous version of
  // this test tried to do) has no effect on what webhook.service.ts already
  // captured — so the secret used here has to be the one actually baked into
  // .env at startup, not one injected at runtime.
  const secret = env.WEBHOOK_SECRET_MPESA;

  it('settles a processing intent into a Payment', async () => {
    const user = await makeUser();
    const created = await intents.createPaymentIntent(
      { sub: user.id, role: 'patient' },
      { amount: 4000, currency: 'TZS', method: 'mobile_money', purpose: 'consultation_fee', payer_phone: '+255712345678' },
      mpesaStub,
    );
    intentIds.push(created.id);

    const payload = { provider_reference: created.provider_reference ?? undefined, status: 'succeeded' };
    const body = JSON.stringify(payload);
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    const { handled } = await handleWebhook('mpesa', body, sig, payload);
    assert.equal(handled, true);

    const reloaded = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reloaded.status, 'succeeded');
    assert.ok(reloaded.paymentId);
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
