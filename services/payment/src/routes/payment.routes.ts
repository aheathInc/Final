import { Router, raw as rawBodyParser } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/payment.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const paymentRouter = Router();

paymentRouter.post('/payments/intents', requireAuth, idempotency, c.createIntent);
paymentRouter.get('/payments/intents/:payment_intent_id', requireAuth, c.getIntent);
paymentRouter.post('/payments/intents/:payment_intent_id/cancel', requireAuth, idempotency, c.cancelIntent);

paymentRouter.get('/payments', requireAuth, c.listPayments);
paymentRouter.post('/payments/:payment_id/refund', requireAuth, idempotency, c.refund);

// Captures the exact raw bytes before Express's normal JSON parser would
// otherwise consume and re-serialise the body — the HMAC has to be computed
// over precisely what the provider sent.
paymentRouter.post(
  '/payments/webhooks/:provider',
  rawBodyParser({ type: '*/*' }),
  (req, _res, next) => {
    (req as typeof req & { rawBody: string }).rawBody = req.body.toString('utf8');
    try {
      req.body = JSON.parse((req as typeof req & { rawBody: string }).rawBody || '{}');
    } catch {
      req.body = {};
    }
    next();
  },
  c.webhook,
);
