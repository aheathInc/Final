import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/diagnostics.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const diagnosticsRouter = Router();

diagnosticsRouter.post('/investigation-orders', requireAuth, idempotency, c.create);
diagnosticsRouter.get('/investigation-orders', requireAuth, c.list);
diagnosticsRouter.get('/investigation-orders/:order_id', requireAuth, c.getOne);
diagnosticsRouter.post('/investigation-orders/:order_id/results', requireAuth, idempotency, c.fileResult);
diagnosticsRouter.post('/investigation-orders/:order_id/acknowledge', requireAuth, c.acknowledge);
