import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { knownTemplates } from './templates.js';

/**
 * The only way anything gets queued.
 *
 * Producers name a template and supply variables; they never write a message
 * body. That keeps every outbound string in one reviewed file, translatable,
 * and countable — and it is what makes it possible to answer "what exactly do
 * we send patients?" without grepping nine services.
 */
export async function enqueue(input: {
  userId: string;
  templateKey: string;
  vars?: Record<string, string>;
  /** Message templates default to a grace period so a read message is never resent. */
  deliverAfter?: Date;
}): Promise<string | null> {
  if (!knownTemplates.includes(input.templateKey)) {
    throw new Error(`Unknown notification template: ${input.templateKey}`);
  }

  const deliverAfter =
    input.deliverAfter ??
    (input.templateKey === 'thread.message'
      ? new Date(Date.now() + env.MESSAGE_SMS_GRACE_SECONDS * 1000)
      : null);

  const row = await prisma.notificationLog.create({
    data: {
      userId: input.userId,
      channel: 'sms',
      templateKey: input.templateKey,
      payload: (input.vars ?? {}) as never,
      deliverAfter,
    },
  });
  return row.id;
}
