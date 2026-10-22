import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
import { resolveProvider } from '../providers/index.js';
import { render, type LanguageCode } from '../services/templates.js';
import { careDeliveryAllowed } from '../services/care-delivery.js';
const logger = createLogger('notification.dispatch');
export interface DispatchResult { sent: number; skipped: number; failed: number; simulated: number }
/**
 * Leased claims prevent concurrent workers sending the same row. The HTTP
 * adapter forwards the stable row ID as an idempotency key. A crash after a
 * provider accepts but before DB acknowledgement is an at-least-once boundary;
 * exactly-once delivery requires provider-side idempotency. Never claim receipt.
 */
export async function dispatchOnce(now = new Date()): Promise<DispatchResult> {
  const provider = resolveProvider();
  const wallStarted = Date.now();
  const clock = () => new Date(now.getTime() + Math.max(0, Date.now() - wallStarted));
  const rows = await prisma.notificationLog.findMany({ where: { status: 'queued', attempts: { lt: env.MAX_ATTEMPTS },
    AND: [{ OR: [{ deliverAfter: null }, { deliverAfter: { lte: now } }] }, { OR: [{ claimUntil: null }, { claimUntil: { lte: now } }] }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: env.DISPATCH_BATCH_SIZE,
  });
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, simulated: 0 };
  for (const candidate of rows) {
    const token = randomUUID(), claimedAt = clock();
    const claim = await prisma.notificationLog.updateMany({ where: { id: candidate.id, status: 'queued', attempts: { lt: env.MAX_ATTEMPTS },
      AND: [{ OR: [{ claimUntil: null }, { claimUntil: { lte: claimedAt } }] },
        { OR: [{ deliverAfter: null }, { deliverAfter: { lte: claimedAt } }] }] }, data: {
      claimToken: token, claimUntil: new Date(claimedAt.getTime() + env.DISPATCH_LEASE_SECONDS * 1000), attempts: { increment: 1 },
    } });
    if (!claim.count) continue;
    const row = await prisma.notificationLog.findUniqueOrThrow({ where: { id: candidate.id }, include: {
      user: { select: { phoneNumber: true, preferredLanguage: true, status: true } },
    } });
    if (row.claimToken !== token) continue;
    const finish = async (data: { status: 'queued' | 'sent' | 'delivered' | 'failed'; failureCode?: string | null; providerRef?: string | null; sentAt?: Date | null; deliverAfter?: Date | null }) =>
      prisma.notificationLog.updateMany({ where: { id: row.id, status: 'queued', claimToken: token },
        data: { ...data, claimToken: null, claimUntil: null } });
    try {
      if (row.user.status !== 'active') { await finish({ status: 'failed', failureCode: 'ACCOUNT_INACTIVE' }); result.skipped++; continue; }
      if (row.templateKey.startsWith('care.') && !await careDeliveryAllowed(row.id, row.userId, clock())) {
        await finish({ status: 'failed', failureCode: 'SUPERSEDED_CARE' }); result.skipped++; continue;
      }
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      if (row.templateKey === 'thread.message' && typeof payload.messageId === 'string') {
        const message = await prisma.message.findUnique({ where: { id: payload.messageId }, select: { readAt: true } });
        if (message?.readAt) { await finish({ status: 'delivered', failureCode: 'SUPERSEDED_READ' }); result.skipped++; continue; }
      }
      const body = render(row.templateKey, row.user.preferredLanguage as LanguageCode,
        Object.fromEntries(Object.entries(payload).filter(([, v]) => typeof v === 'string')) as Record<string, string>);
      if (!body) { await finish({ status: 'failed', failureCode: 'UNKNOWN_TEMPLATE' }); result.failed++; continue; }
      const sent = await provider.send(row.user.phoneNumber, body, { idempotencyKey: row.id });
      if (sent.ok) {
        const acknowledged = await finish({ status: 'sent', failureCode: null, providerRef: sent.providerRef ?? null, sentAt: clock() });
        if (acknowledged.count) { result.sent++; if (provider.name === 'console') result.simulated++; }
      } else {
        const terminal = sent.retryable === false || row.attempts >= env.MAX_ATTEMPTS;
        await finish({ status: terminal ? 'failed' : 'queued', failureCode: sent.failureCode ?? 'PROVIDER_FAILURE',
          deliverAfter: terminal ? null : new Date(clock().getTime() + Math.min(2 ** row.attempts, 32) * 30_000) });
        result.failed++;
      }
    } catch {
      // No exception bodies or provider payloads in ordinary logs.
      const terminal = row.attempts >= env.MAX_ATTEMPTS;
      await finish({ status: terminal ? 'failed' : 'queued', failureCode: 'DISPATCH_ERROR',
        deliverAfter: terminal ? null : new Date(clock().getTime() + Math.min(2 ** row.attempts, 32) * 30_000) });
      result.failed++;
    }
  }
  // A crashed final attempt must not leave a queued row permanently stranded.
  await prisma.notificationLog.updateMany({ where: { status: 'queued', attempts: { gte: env.MAX_ATTEMPTS },
    OR: [{ claimUntil: null }, { claimUntil: { lte: clock() } }] }, data: { status: 'failed', failureCode: 'ATTEMPTS_EXHAUSTED', claimToken: null, claimUntil: null } });
  return result;
}
export function startDispatchWorker(): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void dispatchOnce().then(r => { if (r.sent + r.failed) logger.info('dispatch', { ...r }); })
      .catch(() => logger.error('dispatch failed', { code: 'DISPATCH_TICK_FAILED' })).finally(() => { running = false; });
  }, env.DISPATCH_INTERVAL_SECONDS * 1000);
  timer.unref(); return timer;
}
