import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/families.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const familiesRouter = Router();

familiesRouter.post('/families', requireAuth, idempotency, c.create);
familiesRouter.get('/families/me', requireAuth, c.getMine);
familiesRouter.post('/families/:family_id/members', requireAuth, idempotency, c.addMember);
familiesRouter.post('/families/:family_id/assignments', requireAuth, idempotency, c.assignDoctors);
