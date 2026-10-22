import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { prisma } from '@a-health/database';
import { dispatchOnce } from '../workers/dispatch.worker.js';
import { render, knownTemplates } from '../services/templates.js';

if (process.env.NODE_ENV !== 'test' || process.env.SMS_PROVIDER !== 'console') {
  throw new Error('Notification DB tests require NODE_ENV=test and SMS_PROVIDER=console.');
}
let target: URL;
try { target = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Explicit isolated test DATABASE_URL required.'); }
const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
const targetSchema = target.searchParams.get('schema');
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !((targetDatabase === 'ahealth_test' && targetSchema === 'public') || (targetDatabase === 'ahealth_dev' && /^ahp_test_[a-z0-9_]+$/.test(targetSchema ?? ''))) ||
    target.searchParams.getAll('schema').length !== 1 || !target.port || target.port === '5432' ||
    !['localhost','127.0.0.1','[::1]','::1'].includes(target.hostname)) {
  throw new Error('Notification tests require an explicitly isolated loopback database/schema on a non-5432 port.');
}
before(async () => {
  const [row] = await prisma.$queryRaw<Array<{ db: string; schema: string; schemaOwner: string; role: string; port: number; address: string }>>`
    SELECT current_database() AS db, current_schema()::text AS schema,
           (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = current_schema()) AS "schemaOwner",
           current_user::text AS role, inet_server_port() AS port, inet_server_addr()::text AS address`;
  if (!row || row.db !== targetDatabase || row.schema !== targetSchema || row.schemaOwner !== row.role ||
      row.port !== Number(target.port) || !/^(127\.|::1$)/.test(row.address.replace(/^::ffff:/, '').replace(/\/\d+$/, ''))) {
    throw new Error('Database identity is not the approved isolated test target.');
  }
});

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

  it('keeps adherence and screening SMS privacy-minimized', () => {
    const variables = {
      medication: 'SyntheticSensitiveMedication',
      dosage: '987mg',
      programme: 'SyntheticSensitiveScreening',
    };
    const adherence = render('adherence.reminder', 'en', variables)!;
    const screening = render('screening.invitation', 'en', variables)!;
    for (const body of [adherence, screening]) {
      assert.doesNotMatch(body, /SyntheticSensitiveMedication|987mg|SyntheticSensitiveScreening/);
    }
    assert.match(adherence, /Reply 1 if taken, 2 if not/);
    assert.match(screening, /Open the app for details/);
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


describe('leased dispatch', () => {
  it('concurrent workers claim one queued notification at most once', async () => {
    const user = await makeUser(); const n = await prisma.notificationLog.create({ data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {}, dedupeKey: `test:${user.id}` } });
    await Promise.all([dispatchOnce(), dispatchOnce()]);
    const saved = await prisma.notificationLog.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(saved.status, 'sent'); assert.equal(saved.attempts, 1); assert.equal(saved.claimToken, null);
  });
  it('suppresses a care notification lacking an active owned reminder', async () => {
    const user = await makeUser(); const n = await prisma.notificationLog.create({ data: { userId: user.id, channel: 'sms', templateKey: 'care.dose_due', payload: {} } });
    await dispatchOnce(); const saved = await prisma.notificationLog.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(saved.status, 'failed'); assert.equal(saved.failureCode, 'SUPERSEDED_CARE');
  });
  it('reclaims an expired lease without an unbounded wait', async () => {
    const user = await makeUser(); const n = await prisma.notificationLog.create({ data: { userId: user.id, channel: 'sms', templateKey: 'consultation.assigned', payload: {}, claimToken: user.id, claimUntil: new Date(Date.now()-10000), attempts: 1 } });
    await dispatchOnce(); const saved = await prisma.notificationLog.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(saved.status, 'sent'); assert.equal(saved.attempts, 2);
  });
});
