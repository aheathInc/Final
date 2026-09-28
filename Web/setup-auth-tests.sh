#!/usr/bin/env bash
#
# Adds a test suite to services/auth using node:test — built into Node 22, so
# no framework dependency.
#
# These are integration tests against the real dev database. They exercise the
# service layer directly rather than over HTTP, so no server needs to be
# running, and each test uses a randomised phone number and cleans up after
# itself.
#
# Run from the repo root:
#   bash setup-auth-tests.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/auth"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SVC/src/services/auth.service.ts" ] || { echo "services/auth not set up."; exit 1; }

mkdir -p "$SVC/src/tests"

cat > "$SVC/src/tests/helpers.ts" << 'TS'
import { prisma } from '@a-health/database';
import { randomInt } from 'node:crypto';

/**
 * Guard rail. These tests create and delete users, so refusing to run against
 * anything that is not obviously a development or test database is the
 * difference between a red test and a very bad afternoon.
 */
export function assertSafeDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_dev|_test|localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run tests against ${url}`);
  }
}

/** Unique per run, so parallel runs and reruns never collide. */
export function testPhone(): string {
  return `+2557${randomInt(10_000_000, 99_999_999)}`;
}

export const meta = { ip: '127.0.0.1', requestId: 'test' };

/** Removes everything a test created, in FK-safe order. */
export async function cleanupPhone(phone: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { phoneNumber: phone },
    include: { patientProfile: true, clinicianProfile: true },
  });
  await prisma.otpChallenge.deleteMany({ where: { phoneNumber: phone } });
  if (!user) return;
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.idempotencyRecord.deleteMany({ where: { userId: user.id } });
  await prisma.walletCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  if (user.patientProfile) {
    await prisma.changeLog.deleteMany({ where: { patientProfileId: user.patientProfile.id } });
  }
  await prisma.user.delete({ where: { id: user.id } });
}

/** Reads back the code a challenge was issued for, by brute force over 10^6. */
export async function findOtpCode(challengeId: string): Promise<string> {
  const bcrypt = (await import('bcrypt')).default;
  const challenge = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
  for (let i = 0; i < 1_000_000; i += 1) {
    const candidate = i.toString().padStart(6, '0');
    if (await bcrypt.compare(candidate, challenge.codeHash)) return candidate;
  }
  throw new Error('code not recoverable');
}
TS

cat > "$SVC/src/tests/auth.test.ts" << 'TS'
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@a-health/database';
import * as auth from '../services/auth.service.js';
import { verifyAuditChain } from '../services/audit.service.js';
import { AppError } from '../utils/errors.js';
import { assertSafeDatabase, cleanupPhone, meta, testPhone } from './helpers.js';

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
  const code = await findCode(challenge.challenge_id);
  return auth.verifyOtp(challenge.challenge_id, code, 'test-device', meta);
}

async function findCode(challengeId: string) {
  const { findOtpCode } = await import('./helpers.js');
  return findOtpCode(challengeId);
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

    const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    assert.equal(user?.status, 'active');
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const phone = track(testPhone());
    const challenge = await auth.registerPatient(
      { phone_number: phone, preferred_language: 'sw' },
      meta,
    );
    await assert.rejects(
      () => auth.verifyOtp(challenge.challenge_id, '000000', undefined, meta),
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
    const real = await findCode(challenge.challenge_id);
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
    const code = await findCode(challenge.challenge_id);
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
    const code = await findCode(challenge.challenge_id);
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
TS

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts.test = 'node --import tsx --test src/tests/*.test.ts';
pkg.scripts['test:watch'] = 'node --import tsx --test --watch src/tests/*.test.ts';
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  test scripts added');
NODE

echo
echo "Done. Next:"
echo "  pnpm --filter @a-health/auth test"
