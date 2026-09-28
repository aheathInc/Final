import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService, type EventBus } from '@a-health/http';
import { env } from '../config/env.js';
import { buildControllers } from '../controllers/message.controller.js';

export function buildRouter(bus: EventBus): Router {
  const tokens = createTokenService({
    secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const { requireAuth } = createAuthGuards(tokens);
  const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
  const c = buildControllers(bus);

  const router = Router();
  router.get('/care-threads/:care_thread_id/messages', requireAuth, c.list);
  router.post('/care-threads/:care_thread_id/messages', requireAuth, idempotency, c.create);
  router.post('/care-threads/:care_thread_id/messages/read', requireAuth, c.markRead);
  router.post('/realtime/token', requireAuth, c.realtimeToken);
  return router;
}
