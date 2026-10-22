import assert from 'node:assert/strict';
import test from 'node:test';
import type { Logger } from '@a-health/logger';
import { createErrorHandler } from '../middleware/error.js';

function invoke(exposeInternals: boolean, error: unknown) {
  let logged: Record<string, unknown> | undefined;
  let statusCode = 0;
  let responseBody: Record<string, any> | undefined;
  const logger = {
    debug() {}, info() {}, warn() {}, child() { return this; },
    error(_message: string, fields?: Record<string, unknown>) { logged = fields; },
  } as unknown as Logger;
  const response = {
    locals: { requestId: 'synthetic-request-id' },
    status(code: number) { statusCode = code; return this; },
    json(body: Record<string, any>) { responseBody = body; return this; },
  };

  createErrorHandler(logger, exposeInternals)(
    error as never,
    {} as never,
    response as never,
    (() => undefined) as never,
  );

  return { logged, statusCode, responseBody };
}

test('production unexpected-error logs omit messages and stack traces', () => {
  const error = new Error('SYNTHETIC_PRIVATE_ERROR_SENTINEL');
  error.stack = 'SYNTHETIC_PRIVATE_STACK_SENTINEL';
  const result = invoke(false, error);

  assert.equal(result.statusCode, 500);
  assert.equal(result.responseBody?.error.message, 'An unexpected error occurred');
  assert.equal(result.logged?.requestId, 'synthetic-request-id');
  assert.deepEqual(result.logged?.err, { name: 'Error' });
  assert.doesNotMatch(JSON.stringify(result.logged), /SYNTHETIC_PRIVATE_(ERROR|STACK)_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(result.responseBody), /SYNTHETIC_PRIVATE_(ERROR|STACK)_SENTINEL/);
});

test('development retains exception detail for local diagnosis', () => {
  const error = new Error('SYNTHETIC_DEVELOPMENT_ERROR_SENTINEL');
  const result = invoke(true, error);

  assert.equal(result.responseBody?.error.details.message, 'SYNTHETIC_DEVELOPMENT_ERROR_SENTINEL');
  assert.match(JSON.stringify(result.logged), /SYNTHETIC_DEVELOPMENT_ERROR_SENTINEL/);
});
