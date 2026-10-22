import { prisma } from '@a-health/database';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
import { resolveProvider } from '../providers/index.js';
import { render, type LanguageCode } from '../services/templates.js';

const logger = createLogger('notification.dispatch');

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Drains queued notifications.
 *
 * Two rules carry most of the weight:
 *
 * A message the recipient already read is not sent again. Without that check
 * every in-app conversation would also bill an SMS per message, and patients
 * would be woken by texts about messages they had answered an hour earlier.
 *
 * Permanent failures are not retried. A malformed number does not become valid
 * on the fourth attempt, and burning the retry budget on it delays the
 * notifications that would have worked.
 */
export async function dispatchOnce(now = new Date()): Promise<DispatchResult> {
  const provider = resolveProvider();

  const queued = await prisma.notificationLog.findMany({
    where: {
      status: 'queued',
      attempts: { lt: env.MAX_ATTEMPTS },
      OR: [{ deliverAfter: null }, { deliverAfter: { lte: now } }],
    },
    include: {
      user: { select: { phoneNumber: true, preferredLanguage: true, fullName: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: env.DISPATCH_BATCH_SIZE,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of queued) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    if (row.user.status !== 'active') {
      await mark(row.id, 'failed', { failureCode: 'ACCOUNT_INACTIVE' });
      skipped += 1;
      continue;
    }

    // Superseded: the recipient opened the app and read it. Nothing to send.
    if (row.templateKey === 'thread.message' && typeof payload.messageId === 'string') {
      const message = await prisma.message.findUnique({
        where: { id: payload.messageId },
        select: { readAt: true },
      });
      if (message?.readAt) {
        await mark(row.id, 'delivered', { failureCode: 'SUPERSEDED_READ' });
        skipped += 1;
        continue;
      }
    }

    const body = render(
      row.templateKey,
      row.user.preferredLanguage as LanguageCode,
      Object.fromEntries(
        Object.entries(payload).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>,
    );

    if (!body) {
      // An unknown template is a bug, not a transient failure. Fail it loudly
      // rather than retrying something that will never render.
      logger.error('unknown template', { templateKey: row.templateKey, id: row.id });
      await mark(row.id, 'failed', { failureCode: 'UNKNOWN_TEMPLATE' });
      failed += 1;
      continue;
    }

    const result = await provider.send(row.user.phoneNumber, body);

    if (result.ok) {
      await mark(row.id, 'sent', { providerRef: result.providerRef, sentAt: new Date() });
      sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    const permanent = result.retryable === false;
    const exhausted = attempts >= env.MAX_ATTEMPTS;

    await prisma.notificationLog.update({
      where: { id: row.id },
      data: {
        attempts,
        failureCode: result.failureCode ?? 'UNKNOWN',
        status: permanent || exhausted ? 'failed' : 'queued',
        // Exponential backoff. Retrying a struggling gateway immediately makes
        // it struggle harder.
        deliverAfter: permanent || exhausted
          ? null
          : new Date(now.getTime() + Math.min(2 ** attempts, 32) * 30_000),
      },
    });
    failed += 1;
  }

  return { sent, skipped, failed };
}

async function mark(
  id: string,
  status: 'sent' | 'delivered' | 'failed',
  extra: { providerRef?: string; failureCode?: string; sentAt?: Date } = {},
) {
  await prisma.notificationLog.update({
    where: { id },
    data: {
      status: status as never,
      providerRef: extra.providerRef ?? null,
      failureCode: extra.failureCode ?? null,
      sentAt: extra.sentAt ?? null,
      attempts: { increment: 1 },
    },
  });
}

export function startDispatchWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void dispatchOnce()
      .then((r) => {
        if (r.sent + r.failed > 0) logger.info('dispatch', { ...r });
      })
      .catch((e) => logger.error('dispatch failed', { err: String(e) }));
  }, env.DISPATCH_INTERVAL_SECONDS * 1000);
  timer.unref();
  logger.info('dispatch worker started', {
    provider: env.SMS_PROVIDER,
    intervalSeconds: env.DISPATCH_INTERVAL_SECONDS,
  });
  return timer;
}
