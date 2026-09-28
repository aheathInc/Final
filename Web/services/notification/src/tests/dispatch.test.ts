import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { prisma } from '@a-health/database';
import { dispatchOnce } from '../workers/dispatch.worker.js';
import { render, knownTemplates } from '../services/templates.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];

after(async () => {
  for (const id of users) {
    await prisma.notificationLog.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeUser(language: 'sw' | 'en' = 'sw', status: 'active' | 'suspended' = 'active') {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient',
      status,
      fullName: 'Notify Test',
      preferredLanguage: language,
    },
  });
  users.push(user.id);
  return user;
}

describe('templates', () => {
  it('renders Swahili for every template', () => {
    for (const key of knownTemplates) {
      assert.ok(render(key, 'sw', { sender: 'Dkt', medication: 'x', dosage: '1', programme: 'y' }));
    }
  });

  it('falls back rather than returning nothing for an untranslated language', () => {
    // A missing translation must never mean a missing message.
    assert.ok(render('thread.message', 'ha', {}));
  });

  it('keeps messages to a single SMS segment', () => {
    for (const key of knownTemplates) {
      const body = render(key, 'sw', { sender: 'Dkt. Asha', medication: 'Amoxicillin', dosage: '500mg', programme: 'saratani' });
      assert.ok(body!.length <= 160, `${key} is ${body!.length} characters`);
    }
  });

  it('returns null for an unknown template', () => {
    assert.equal(render('does.not.exist', 'sw'), null);
  });
});

describe('dispatch', () => {
  it('sends a queued notification', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {} },
    });

    const result = await dispatchOnce();
    assert.ok(result.sent >= 1);

    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'sent');
  });

  it('holds a notification until deliverAfter', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: {
        userId: user.id, channel: 'sms', templateKey: 'consultation.assigned',
        payload: {}, deliverAfter: new Date(Date.now() + 600_000),
      },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'queued', 'a held notification must not go early');
  });

  it('does not text a suspended account', async () => {
    const user = await makeUser('sw', 'suspended');
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {} },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'ACCOUNT_INACTIVE');
  });

  it('fails an unknown template instead of retrying it forever', async () => {
    const user = await makeUser();
    await prisma.notificationLog.create({
      data: { userId: user.id, channel: 'sms', templateKey: 'not.a.template', payload: {} },
    });

    await dispatchOnce();
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'UNKNOWN_TEMPLATE');
  });
});
