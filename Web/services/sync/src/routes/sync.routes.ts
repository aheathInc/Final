import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/sync.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const syncRouter = Router();

syncRouter.get('/sync/changes', requireAuth, c.getChanges);
syncRouter.post('/sync/batch', requireAuth, c.postBatch);
