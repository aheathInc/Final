import type { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthenticated } from '../errors.js';

/**
 * Verifies the telecom aggregator's request the same way the payment
 * webhook verifies a provider's: HMAC of the raw body, compared in constant
 * time. `/gateway/*` is not part of the public API and carries no bearer
 * token — the aggregator does not have one, and one more shared secret is
 * simpler than standing up OAuth for a single upstream caller.
 */
export function createGatewaySignatureGuard(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('X-Gateway-Signature');
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!header || !raw) {
      next(unauthenticated('UNAUTHENTICATED', 'Missing gateway signature'));
      return;
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      next(unauthenticated('UNAUTHENTICATED', 'Gateway signature is not valid'));
      return;
    }
    next();
  };
}
