import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { mintTokenForPhone } from '../services/internalAuth.js';
import { handleUssdSession } from '../services/ussd.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const sessionIds: string[] = [];

after(async () => {
  for (const id of sessionIds) {
    await prisma.ussdSession.deleteMany({ where: { sessionId: id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeActivePatient() {
  const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
  const user = await prisma.user.create({
    data: { phoneNumber: phone, role: 'patient', status: 'active', fullName: 'Gateway Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Gateway Test' } });
  return { phone, user, profile };
}

describe('internal auth', () => {
  it('mints a token for an active, registered phone', async () => {
    const { phone, profile } = await makeActivePatient();
    const auth = await mintTokenForPhone(phone);
    assert.ok(auth);
    assert.equal(auth!.claims.ppid, profile.id);
  });

  it('returns null for an unregistered phone', async () => {
    const auth = await mintTokenForPhone('+255700000000');
    assert.equal(auth, null);
  });

  it('returns null for a suspended account', async () => {
    const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
    const user = await prisma.user.create({ data: { phoneNumber: phone, role: 'patient', status: 'suspended', fullName: 'Suspended' } });
    users.push(user.id);

    const auth = await mintTokenForPhone(phone);
    assert.equal(auth, null);
  });

  it('does not mint Patient-channel tokens for active staff accounts', async () => {
    const user = await prisma.user.create({
      data: {
        phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
        role: 'clinician',
        status: 'active',
        fullName: 'Gateway Staff Test',
      },
    });
    users.push(user.id);

    assert.equal(await mintTokenForPhone(user.phoneNumber), null);
  });
});

describe('ussd menu', () => {
  it('shows the main menu on a fresh session', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    const result = await handleUssdSession(sessionId, '+255700000001', '');
    assert.match(result.response, /A-Health/);
    assert.equal(result.terminate, false);
  });

  it('tells an unregistered caller to register, and ends the session', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    await handleUssdSession(sessionId, '+255700000002', '');
    const result = await handleUssdSession(sessionId, '+255700000002', '2');
    assert.match(result.response, /not registered/i);
    assert.equal(result.terminate, true);
  });

  it('keeps a fixed session-id string under the 182-character USSD reply limit', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    const result = await handleUssdSession(sessionId, '+255700000003', '');
    assert.ok(result.response.length <= 182);
  });

  it('expires and restarts a session past its TTL', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    await handleUssdSession(sessionId, '+255700000004', '');
    await prisma.ussdSession.update({ where: { sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await handleUssdSession(sessionId, '+255700000004', '2');
    assert.match(result.response, /A-Health/);
  });

  it('keeps invalid input, caller mismatch and replay from executing a menu action', async () => {
    const { phone } = await makeActivePatient();
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    await handleUssdSession(sessionId, phone, '');

    const invalid = await handleUssdSession(sessionId, phone, '9');
    assert.match(invalid.response, /A-Health/);
    assert.equal(invalid.terminate, false);

    let internalCalls = 0;
    const callInternal = async () => {
      internalCalls++;
      return { ok: true, status: 200, body: {} };
    };
    const mismatch = await handleUssdSession(
      sessionId,
      '+255700000099',
      '2',
      { callInternal },
    );
    assert.equal(mismatch.terminate, true);
    assert.match(mismatch.response, /caller mismatch/i);
    assert.equal(internalCalls, 0);

    const status = await handleUssdSession(
      sessionId,
      phone,
      '2',
      { callInternal },
    );
    assert.equal(status.terminate, true);
    assert.match(status.response, /full queue details/i);
    assert.equal(internalCalls, 1);

    const replay = await handleUssdSession(
      sessionId,
      phone,
      '2',
      { callInternal },
    );
    assert.equal(replay.terminate, false);
    assert.match(replay.response, /A-Health/);
    assert.equal(internalCalls, 1);
  });
});
