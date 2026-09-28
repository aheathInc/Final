import { randomBytes } from 'node:crypto';
import { prisma } from '@a-health/database';
import { sha256, unauthenticated } from '@a-health/http';
import { env } from '../config/env.js';

/**
 * Mints a single-use ticket for the WebSocket handshake.
 *
 * The browser WebSocket API cannot set an Authorization header, so the
 * credential has to travel in the URL — and URLs end up in access logs, proxy
 * logs and browser history. Sixty seconds and single use mean a ticket
 * recovered from a log is already spent.
 */
export async function issueTicket(userId: string, deviceId?: string) {
  const ticket = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REALTIME_TICKET_TTL_SECONDS * 1000);

  await prisma.realtimeTicket.create({
    data: { userId, ticketHash: sha256(ticket), deviceId: deviceId ?? null, expiresAt },
  });

  return {
    ticket,
    expires_at: expiresAt.toISOString(),
    url: env.PUBLIC_WS_URL,
  };
}

/** Redeems a ticket. The conditional update is the single-use guarantee. */
export async function redeemTicket(ticket: string): Promise<string> {
  const hash = sha256(ticket);
  const row = await prisma.realtimeTicket.findUnique({ where: { ticketHash: hash } });
  if (!row) throw unauthenticated('TOKEN_INVALID', 'Ticket is not valid');
  if (row.expiresAt < new Date()) throw unauthenticated('TOKEN_EXPIRED', 'Ticket has expired');

  const consumed = await prisma.realtimeTicket.updateMany({
    where: { ticketHash: hash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw unauthenticated('TOKEN_INVALID', 'Ticket has already been used');

  return row.userId;
}

/** Expired and spent tickets are worthless within a minute; sweep them hourly. */
export async function sweepTickets(now = new Date()): Promise<number> {
  const result = await prisma.realtimeTicket.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 3600_000) } },
  });
  return result.count;
}
