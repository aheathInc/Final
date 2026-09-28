import { createLogger } from '@a-health/logger';

const logger = createLogger('gateway.internal-client');

export interface InternalCallResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T | { error?: { code?: string; message?: string } };
}

/**
 * Calls another service exactly the way the app does: a bearer token, a
 * normal JSON body. No shared-secret shortcut, no direct-database bypass —
 * the whole point of minting a real token is that this call is
 * indistinguishable, on the receiving end, from one the app itself made.
 */
export async function callInternal<T = unknown>(
  baseUrl: string, path: string, method: 'GET' | 'POST', token: string, body?: unknown,
): Promise<InternalCallResult<T>> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `gw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: parsed as T };
  } catch (err) {
    logger.error('internal call failed', { baseUrl, path, err: String(err) });
    return { ok: false, status: 0, body: { error: { code: 'SERVICE_UNAVAILABLE', message: String(err) } } };
  }
}
