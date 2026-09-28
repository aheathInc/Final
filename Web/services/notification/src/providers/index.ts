import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('notification.provider');

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  failureCode?: string;
  /** False for anything permanent — a wrong number is not worth four attempts. */
  retryable?: boolean;
}

export interface NotificationProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SendResult>;
}

/** Development. Prints the message so a flow can be followed without a gateway. */
export const consoleProvider: NotificationProvider = {
  name: 'console',
  async send(to, body) {
    logger.info('sms (console)', { to: to.slice(0, 6) + '****', length: body.length });
    // The number is masked and the body is never printed. A development log is
    // still a log, and clinical text does not belong in one.
    return { ok: true, providerRef: 'console-' + Date.now() };
  },
};

/**
 * Generic HTTP gateway, shaped for the aggregators used in the region. The
 * exact payload differs per provider; this is the seam to adapt, not the
 * calling code.
 */
export const httpProvider: NotificationProvider = {
  name: 'http',
  async send(to, body) {
    try {
      const response = await fetch(env.SMS_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SMS_GATEWAY_KEY}`,
        },
        body: JSON.stringify({ to, from: env.SMS_SENDER_ID, message: body }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, providerRef: payload.id };
      }

      // 4xx from the gateway means the request itself is wrong — a malformed
      // number, an unfunded account. Retrying cannot fix either.
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, failureCode: `HTTP_${response.status}`, retryable };
    } catch (err) {
      return { ok: false, failureCode: 'NETWORK', retryable: true, providerRef: undefined };
    }
  },
};

export function resolveProvider(): NotificationProvider {
  return env.SMS_PROVIDER === 'http' ? httpProvider : consoleProvider;
}
