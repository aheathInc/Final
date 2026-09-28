import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '@a-health/logger';
import { AppError } from '../errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      request_id: res.locals.requestId,
    },
  });
}

export function createErrorHandler(logger: Logger, exposeInternals = false) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: first?.message ?? 'Request failed validation',
          field: first?.path.join('.'),
          details: { issues: err.issues },
          request_id: requestId,
        },
      });
      return;
    }

    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.field ? { field: err.field } : {}),
          ...(err.details ? { details: err.details } : {}),
          request_id: requestId,
        },
      });
      return;
    }

    // Unexpected. Logged in full; never returned. A stack trace in a 500 body
    // is an information disclosure, and on this platform the stack can contain
    // a patient's data.
    logger.error('unhandled error', {
      requestId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        request_id: requestId,
        ...(exposeInternals ? { details: { message: (err as Error)?.message } } : {}),
      },
    });
  };
}
