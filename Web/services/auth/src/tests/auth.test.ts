import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@a-health/database';
import * as auth from '../services/auth.service.js';
import { verifyAuditChain } from '../services/audit.service.js';
import { AppError } from '../utils/errors.js';
import { assertSafeDatabase, cleanupPhone, codeOf, meta, testPhone } from './helpers.js';

assertSafeDatabase();

const created: string[] = [];
const track = (phone: string) => {
  created.push(phone);
  return phone;
};

after(async () => {
  for (const phone of created) await cleanupPhone(phone).catch(() => undefined);
  await prisma.$disconnect();
});

async function registerAndVerify(phone: string) {
  const challenge = await auth.registerPatient(
    { phone_number: phone, full_name: 'Test Patient', preferred_language: 'sw' },
    meta,
  );
  const code = codeOf(challenge);
  return auth.verifyOtp(challenge.challenge_id, code, 'test-device', meta);
}

describe('registration', () => {
  it('creates a user and a patient profile', async () => {
    const phone = track(testPhone());
    const res = await auth.registerPatient(
      { phone_number: phone, full_name: 'Asha', preferred_language: 'sw' },
      meta,
    );
    assert.ok(res.challenge_id);
    assert.match(res.masked_destination, /\*{4}/);

    const user = await prisma.user.findUnique({
      where: { phoneNumber: phone },
      include: { patientProfile: true },
    });
    assert.equal(user?.status, 'pending_verification');
    assert.ok(user?.patientProfile);
  });

  it('does not create a second user for a phone already registered', async () => {
    const phone = track(testPhone());
    await auth.registerPatient({ phone_number: phone, preferred_language: 'sw' }, meta);
    await auth.registerPatient({ phone_number: phone, preferred_language: 'sw' }, meta);

    const count = await prisma.user.count({ where: { phoneNumber: phone } });
    assert.equal(count, 1, 'a repeat registration must not fork the account');
  });

  it('masks the destination rather than echoing the number', async () => {
    const phone = track(testPhone());
    const res = await auth.registerPatient({ phone_number: phone, preferred_language: 'sw' }, meta);
    assert.ok(!res.masked_destination.includes(phone.slice(5, -4)));
  });
});

describe('otp verification', () => {
  it('activates the account and returns a token pair', async () => {
    const phone = track(testPhone());
    const session = await registerAndVerify(phone);

    assert.ok(session.access_token);
    assert.ok(session.refresh_token);
    assert.equal(session.token_type, 'Bearer');
    assert.ok(session.user);
    assert.equal(session.user.phone_number, phone);

    const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    assert.equal(user?.status, 'active');
  });

  it('allows the development bypass code and returns profile details', async () => {
    const phone = track(testPhone());
    const challenge = await auth.requestOtp(phone, 'sms');
    const session = await auth.verifyOtp(challenge.challenge_id, '000000', 'test-device', meta);

    assert.ok(session.access_token);
    assert.ok(session.refresh_token);
    assert.ok(session.user);
    assert.equal(session.user.phone_number, phone);
    assert.ok(session.user.full_name);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const phone = track(testPhone());
    const challenge = await auth.registerPatient(
      { phone_number: phone, preferred_language: 'sw' },
      meta,
    );
    await assert.rejects(
      () => auth.verifyOtp(challenge.challenge_id, '111111', undefined, meta),
      (e: AppError) => ['OTP_INVALID', 'OTP_ATTEMPTS_EXCEEDED'].includes(e.code),
    );
    const row = await prisma.otpChallenge.findUniqueOrThrow({
      where: { id: challenge.challenge_id },
    });
    assert.ok(row.attempts >= 1);
  });

  it('kills the challenge once attempts are exhausted', async () => {
    const phone = track(testPhone());
    const challenge = await auth.registerPatient(
      { phone_number: phone, preferred_language: 'sw' },
      meta,
    );
    const real = codeOf(challenge);
    const wrong = real === '111111' ? '222222' : '111111';

    for (let i = 0; i < 5; i += 1) {
      await auth.verifyOtp(challenge.challenge_id, wrong, undefined, meta).catch(() => undefined);
    }

    // Even the correct code must now fail. A challenge that survives its own
    // attempt limit is an open guessing window.
    await assert.rejects(
      () => auth.verifyOtp(challenge.challenge_id, real, undefined, meta),
      (e: AppError) => e.code === 'OTP_ATTEMPTS_EXCEEDED' || e.code === 'OTP_INVALID',
    );
  });

  it('rejects an expired challenge', async () => {
    const phone = track(testPhone());
    const challenge = await auth.registerPatient(
      { phone_number: phone, preferred_language: 'sw' },
      meta,
    );
    const code = codeOf(challenge);
    await prisma.otpChallenge.update({
      where: { id: challenge.challenge_id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      () => auth.verifyOtp(challenge.challenge_id, code, undefined, meta),
      (e: AppError) => e.code === 'OTP_EXPIRED',
    );
  });

  it('refuses to reuse a consumed challenge', async () => {
    const phone = track(testPhone());
    const challenge = await auth.registerPatient(
      { phone_number: phone, preferred_language: 'sw' },
      meta,
    );
    const code = codeOf(challenge);
    await auth.verifyOtp(challenge.challenge_id, code, undefined, meta);

    await assert.rejects(
      () => auth.verifyOtp(challenge.challenge_id, code, undefined, meta),
      (e: AppError) => e.code === 'OTP_INVALID',
    );
  });
});

describe('refresh token rotation', () => {
  it('rotates and invalidates the presented token', async () => {
    const phone = track(testPhone());
    const first = await registerAndVerify(phone);
    const second = await auth.refreshSession(first.refresh_token, meta);

    assert.notEqual(first.refresh_token, second.refresh_token);
  });

  it('revokes the whole family when a used token is presented again', async () => {
    const phone = track(testPhone());
    const first = await registerAndVerify(phone);
    await auth.refreshSession(first.refresh_token, meta);

    // Replaying the already-rotated token is the signature of a stolen
    // credential. Nothing in that family may survive it.
    await assert.rejects(
      () => auth.refreshSession(first.refresh_token, meta),
      (e: AppError) => e.code === 'TOKEN_REUSE_DETECTED',
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: phone } });
    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    assert.equal(live, 0, 'every token in the family must be revoked');
  });
});

describe('password login', () => {
  it('refuses patient accounts', async () => {
    const phone = track(testPhone());
    await registerAndVerify(phone);
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: phone } });
    await prisma.user.update({
      where: { id: user.id },
      data: { email: `${user.id}@test.local`, passwordHash: 'x' },
    });

    await assert.rejects(
      () => auth.login({ email: `${user.id}@test.local`, password: 'x' }, meta),
      (e: AppError) => e.code === 'UNAUTHENTICATED',
    );
  });
});

describe('profile', () => {
  it('rejects a stale base_version', async () => {
    const phone = track(testPhone());
    await registerAndVerify(phone);
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: phone } });

    await assert.rejects(
      () => auth.updateMe(user.id, { base_version: user.version - 1, full_name: 'Stale' }),
      (e: AppError) => e.code === 'VERSION_CONFLICT',
    );
  });

  it('increments version on a successful update', async () => {
    const phone = track(testPhone());
    await registerAndVerify(phone);
    const before = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: phone } });

    const after = await auth.updateMe(before.id, {
      base_version: before.version,
      full_name: 'Renamed',
    });
    assert.equal(after.version, before.version + 1);
    assert.equal(after.full_name, 'Renamed');
  });
});

describe('audit chain', () => {
  it('stays intact across writes', async () => {
    const phone = track(testPhone());
    await registerAndVerify(phone);
    const result = await verifyAuditChain(5000);
    assert.equal(result.ok, true, `chain broken at seq ${result.brokenAtSeq}`);
  });
});
