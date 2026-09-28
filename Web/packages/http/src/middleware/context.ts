import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Every request carries an id through the logs and back in the response. When
 * a patient reports that something failed yesterday afternoon, this is the
 * only thing that makes the failure findable.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('X-Request-ID') || randomUUID()).slice(0, 64);
  res.locals.requestId = requestId;
  res.locals.startedAt = Date.now();
  res.setHeader('X-Request-ID', requestId);
  next();
}
