import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { enrollmentHash } from '@a-health/database/enrollment';
import { createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { getBillReceipt } from '../services/receipt.service.js';
import { renderReceipt } from '../services/receipt-pdf.js';
import { createConsoleAdapter } from '../adapters/provider.js';
import { createPaymentIntent } from '../services/intent.service.js';
import { settleVerifiedCharge } from '../services/settlement.service.js';
import { refundPayment } from '../services/refund.service.js';
import { paymentRouter } from '../routes/payment.routes.js';
import { registrationPaymentRouter } from '../routes/registration.routes.js';

const target = assertIsolatedLocalTestTarget(process.env);
let server: ReturnType<ReturnType<typeof express>['listen']>, base = '';
before(async () => {
  await verifyLocalTestIdentity(prisma, target);
  const app = express(); app.use(express.json()); app.use(registrationPaymentRouter); app.use(paymentRouter);
  app.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode ?? 422).json({ error: { code: e.code ?? 'VALIDATION_FAILED' } }));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
async function fixture(pending = false) {
  const user = await prisma.user.create({ data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, fullName: 'Synthetic Receipt Patient', role: 'patient', status: pending ? 'pending_verification' : 'active', onboardingRequired: pending } });
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: user.fullName! } });
  const bill = await prisma.careBill.create({ data: { reference: `TEST-${randomUUID().slice(0, 24)}`, payerUserId: user.id, issuedById: user.id, patientProfileId: profile.id, title: 'Registration', amount: 4000, currency: 'TZS', purpose: 'registration_fee', expiresAt: new Date(Date.now() + 3600000) } });
  const caller = { sub: user.id, role: 'patient' };
  const token = createTokenService({ secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, ttlSeconds: 900 }).sign({ sub: user.id, role: 'patient', status: user.status, jti: randomUUID() });
  const enrollment = `enr_${randomBytes(32).toString('base64url')}`;
  if (pending) await prisma.patientEnrollment.create({ data: { userId: user.id, tokenHash: enrollmentHash(enrollment), expiresAt: new Date(Date.now() + 3600000), billId: bill.id } });
  async function settle() {
    const intent = await createPaymentIntent(caller, { bill_id: bill.id, method: 'mobile_money', provider: 'mpesa', payer_phone: user.phoneNumber }, { mpesa: createConsoleAdapter('mpesa') });
    const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await settleVerifiedCharge({ reference: row.id, transactionId: row.providerTransactionId!, amount: 4000, currency: 'TZS', status: 'succeeded' }, 'console', 'simulated');
    return await prisma.payment.findUniqueOrThrow({ where: { paymentIntentId: row.id } });
  }
  return { user, bill, caller, token, enrollment, settle };
}

test('unsettled requests have no receipt; paid receipt is owner-only and uses server amount', async () => {
  const a = await fixture(), b = await fixture();
  await assert.rejects(() => getBillReceipt(a.bill.id, a.caller), { code: 'STATE_TRANSITION_INVALID' });
  await a.settle();
  const receipt = await getBillReceipt(a.bill.id, a.caller);
  assert.equal(receipt.amount, 4000); assert.equal(receipt.environment, 'simulated');
  assert.equal((await getBillReceipt(a.bill.id, a.caller)).number, receipt.number);
  await assert.rejects(() => getBillReceipt(a.bill.id, b.caller), { code: 'NOT_FOUND' });
  await assert.rejects(() => getBillReceipt(a.bill.id, { ...a.caller, role: 'platform_admin' }), { code: 'ROLE_NOT_PERMITTED' });
  const denied = await fetch(`${base}/payments/bills/${a.bill.id}/receipt`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal(denied.status, 404);
  const downloaded = await fetch(`${base}/payments/bills/${a.bill.id}/receipt`, { headers: { Authorization: `Bearer ${a.token}` } });
  assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-type')!, /application\/pdf/);
  assert.match(downloaded.headers.get('content-disposition')!, /attachment; filename="AHP-R-/);
  assert.equal(downloaded.headers.get('cache-control'), 'no-store');
  assert.equal(Buffer.from(await downloaded.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  await prisma.user.update({ where: { id: a.user.id }, data: { status: 'suspended' } });
  await assert.rejects(() => getBillReceipt(a.bill.id, a.caller), { code: 'ROLE_NOT_PERMITTED' });
});

test('enrollment receipt uses only its own paid bill and rejects expired capabilities', async () => {
  const a = await fixture(true), b = await fixture(true);
  const read = (token: string) => fetch(`${base}/payments/registration/receipt`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await read(a.enrollment)).status, 409);
  await a.settle();
  assert.equal((await read(a.enrollment)).status, 200);
  assert.equal((await read(b.enrollment)).status, 409);
  await prisma.patientEnrollment.update({ where: { userId: a.user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await read(a.enrollment)).status, 401);
});

test('receipt reflects partial and full refunds while keeping the original receipt reference', async () => {
  const a = await fixture(), payment = await a.settle();
  const original = await getBillReceipt(a.bill.id, a.caller);
  const admin = await prisma.user.create({ data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'platform_admin', status: 'active' } });
  await refundPayment(payment.id, { sub: admin.id, role: 'platform_admin' }, { amount: 1000, reason: 'Synthetic test refund' }, {});
  assert.equal((await getBillReceipt(a.bill.id, a.caller)).refundedAmount, 1000);
  await refundPayment(payment.id, { sub: admin.id, role: 'platform_admin' }, { reason: 'Synthetic remaining refund' }, {});
  const full = await getBillReceipt(a.bill.id, a.caller);
  assert.equal(full.refundedAmount, 4000); assert.equal(full.number, original.number);
  assert.ok((await renderReceipt(full)).length > 1000);
});
