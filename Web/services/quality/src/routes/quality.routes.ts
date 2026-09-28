import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/quality.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const qualityRouter = Router();

qualityRouter.post('/consultations/:consultation_id/rating', requireAuth, idempotency, c.rate);
qualityRouter.post('/incident-reports', requireAuth, idempotency, c.createIncident);
qualityRouter.get('/incident-reports', requireAuth, c.listIncidents);
