import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/research.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const researchRouter = Router();

researchRouter.get('/research/datasets', requireAuth, c.listDatasets);
researchRouter.post('/research/queries', requireAuth, idempotency, c.submitQuery);
researchRouter.get('/research/queries/:query_id', requireAuth, c.getQuery);
