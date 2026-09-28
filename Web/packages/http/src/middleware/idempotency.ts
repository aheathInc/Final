import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@a-health/database';
import { conflict, unprocessable } from '../errors.js';
import { hashPayload } from '../hash.js';

/**
 * Replays the first response for a given Idempotency-Key.
 *
 * This is what stops offline sync creating duplicate clinical records: a phone
 * that queued a request, lost signal and retried three times must produce one
 * appointment, not four.
 *
 * The insert itself is the lock. A concurrent retry loses the unique-constraint
 * race and is told to retry rather than executing in parallel.
 */
export function createIdempotency(ttlHours = 24) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const key = req.header('Idempotency-Key');
        if (!key) {
          next(unprocessable('Idempotency-Key header is required', 'Idempotency-Key'));
          return;
        }

        const requestHash = hashPayload({ method: req.method, path: req.path, body: req.body });
        const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });

        if (existing) {
          if (existing.requestHash !== requestHash) {
            next(
              conflict(
                'IDEMPOTENCY_KEY_CONFLICT',
                'This Idempotency-Key was already used for a different request',
              ),
            );
            return;
          }
          if (existing.responseStatus !== null) {
            res.status(existing.responseStatus).json(existing.responseBody);
            return;
          }
          next(conflict('IDEMPOTENCY_KEY_CONFLICT', 'An identical request is still in flight'));
          return;
        }

        try {
          await prisma.idempotencyRecord.create({
            data: {
              key,
              userId: req.auth?.sub ?? null,
              method: req.method,
              path: req.path,
              requestHash,
              lockedAt: new Date(),
              expiresAt: new Date(Date.now() + ttlHours * 3600_000),
            },
          });
        } catch {
          next(conflict('IDEMPOTENCY_KEY_CONFLICT', 'An identical request is still in flight'));
          return;
        }

        const originalJson = res.json.bind(res);
        res.json = (body: unknown) => {
          void prisma.idempotencyRecord
            .update({
              where: { key },
              data: {
                responseStatus: res.statusCode,
                responseBody: body as object,
                lockedAt: null,
              },
            })
            .catch(() => undefined);
          return originalJson(body);
        };

        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
