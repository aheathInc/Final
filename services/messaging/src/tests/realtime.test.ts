import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { issueTicket, redeemTicket, sweepTickets } from '../services/realtime.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const created: string[] = [];

after(async () => {
  for (const id of created) {
    await prisma.realtimeTicket.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient',
      status: 'active',
      fullName: 'Ticket Test',
    },
  });
  created.push(user.id);
  return user;
}

describe('realtime tickets', () => {
  it('redeems once and returns the owner', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id, 'device-1');
    assert.equal(await redeemTicket(ticket), user.id);
  });

  it('refuses a second redemption', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    await redeemTicket(ticket);

    // A ticket travels in a query string and query strings end up in logs.
    // One recovered from a log has to be worthless.
    await assert.rejects(
      () => redeemTicket(ticket),
      (e: AppError) => e.code === 'TOKEN_INVALID',
    );
  });

  it('refuses an expired ticket', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    await prisma.realtimeTicket.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      () => redeemTicket(ticket),
      (e: AppError) => e.code === 'TOKEN_EXPIRED',
    );
  });

  it('refuses an unknown ticket', async () => {
    await assert.rejects(
      () => redeemTicket(randomUUID()),
      (e: AppError) => e.code === 'TOKEN_INVALID',
    );
  });

  it('never stores the ticket in the clear', async () => {
    const user = await makeUser();
    const { ticket } = await issueTicket(user.id);
    const row = await prisma.realtimeTicket.findFirstOrThrow({ where: { userId: user.id } });
    assert.notEqual(row.ticketHash, ticket);
    assert.equal(row.ticketHash.length, 64);
  });

  it('sweeps tickets that are long past use', async () => {
    const user = await makeUser();
    await issueTicket(user.id);
    await prisma.realtimeTicket.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 7200_000) },
    });
    assert.ok((await sweepTickets()) >= 1);
  });
});
