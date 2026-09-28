import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/insurance.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const insuranceRouter = Router();

insuranceRouter.get('/insurance/coverage', requireAuth, c.getCoverage);
insuranceRouter.post('/insurance/claims', requireAuth, idempotency, c.submitClaim);
insuranceRouter.get('/insurance/claims', requireAuth, c.listClaims);
