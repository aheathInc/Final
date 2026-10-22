import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

const logger = createLogger('sync.batch');

export interface SyncOperation {
  op_id: string;
  method: 'POST' | 'PATCH';
  path: string;
  path_params?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface SyncOperationResult {
  op_id: string;
  status: number;
  body?: unknown;
  error?: { code?: string; message?: string };
}

/**
 * The allow-list itself. Every entry is a path that already exists,
 * unchanged, in the real contract — this is not a second implementation of
 * any of them, only a routing table telling this service which base URL
 * owns each one. Adding a new offline-capable write means adding one line
 * here and one line to the contract's own SyncOperation.path enum — never
 * the other way around, and never a path that isn't in both.
 */
const ALLOWED_OPERATIONS: Record<string, { baseUrl: () => string; template: string }> = {
  '/consultations': { baseUrl: () => env.CONSULTATION_SERVICE_URL, template: '/consultations' },
  '/care-threads/{care_thread_id}/messages': {
    baseUrl: () => env.MESSAGING_SERVICE_URL, template: '/care-threads/{care_thread_id}/messages',
  },
  '/consultations/{consultation_id}/complete': {
    baseUrl: () => env.CONSULTATION_SERVICE_URL, template: '/consultations/{consultation_id}/complete',
  },
  '/check-ins/{check_in_id}/respond': {
    baseUrl: () => env.FOLLOWUP_SERVICE_URL, template: '/check-ins/{check_in_id}/respond',
  },
  '/adherence-logs/{adherence_log_id}/confirm': {
    baseUrl: () => env.FOLLOWUP_SERVICE_URL, template: '/adherence-logs/{adherence_log_id}/confirm',
  },
  '/appointments': { baseUrl: () => env.APPOINTMENT_SERVICE_URL, template: '/appointments' },
  '/appointments/{appointment_id}/cancel': {
    baseUrl: () => env.APPOINTMENT_SERVICE_URL, template: '/appointments/{appointment_id}/cancel',
  },
};

function buildPath(template: string, params: Record<string, string> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params?.[key];
    if (!value) throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

/**
 * Replays one queued operation against the same endpoint the app would have
 * called live, using op_id as the Idempotency-Key — exactly the key that was
 * generated when the user originally acted, so replaying the same entry
 * twice (a client retry, a batch resubmitted after a partial failure) is
 * always safe, never a duplicate write.
 */
async function applyOne(op: SyncOperation, authHeader: string): Promise<SyncOperationResult> {
  const route = ALLOWED_OPERATIONS[op.path];
  if (!route) {
    return { op_id: op.op_id, status: 422, error: { code: 'VALIDATION_FAILED', message: `Path not permitted for offline sync: ${op.path}` } };
  }

  let url: string;
  try {
    url = `${route.baseUrl()}${buildPath(route.template, op.path_params)}`;
  } catch (err) {
    return { op_id: op.op_id, status: 422, error: { code: 'VALIDATION_FAILED', message: String(err) } };
  }

  try {
    const response = await fetch(url, {
      method: op.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'Idempotency-Key': op.op_id,
      },
      body: op.body ? JSON.stringify(op.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => undefined);
    if (response.ok) return { op_id: op.op_id, status: response.status, body };
    const errBody = body as { error?: { code?: string; message?: string } } | undefined;
    return { op_id: op.op_id, status: response.status, body, error: errBody?.error };
  } catch (err) {
    logger.error('offline replay failed', { path: op.path, err: String(err) });
    return { op_id: op.op_id, status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: String(err) } };
  }
}

/**
 * Applies every operation in order, independently — a failure at index 3
 * never rolls back 0-2, matching the contract's own description exactly.
 * Sequential, not parallel: submission order is the order the user actually
 * did things in, and a later operation may depend on an earlier one having
 * already landed (e.g. messaging into a thread a just-created consultation
 * opened).
 */
export async function applyBatch(operations: SyncOperation[], authHeader: string): Promise<SyncOperationResult[]> {
  const results: SyncOperationResult[] = [];
  for (const op of operations) {
    results.push(await applyOne(op, authHeader));
  }
  return results;
}
