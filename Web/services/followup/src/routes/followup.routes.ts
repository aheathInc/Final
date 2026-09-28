import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/followup.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const followupRouter = Router();

followupRouter.get('/follow-up-cycles/:follow_up_cycle_id', requireAuth, c.getCycle);
followupRouter.get('/follow-up-cycles/:follow_up_cycle_id/check-ins', requireAuth, c.listCheckIns);
followupRouter.post('/follow-up-cycles/:follow_up_cycle_id/close', requireAuth, idempotency, c.closeCycle);

followupRouter.get('/check-ins', requireAuth, c.listMyCheckIns);
followupRouter.post('/check-ins/:check_in_id/respond', requireAuth, idempotency, c.respondToCheckIn);

followupRouter.get('/adherence-logs', requireAuth, c.listAdherence);
followupRouter.post('/adherence-logs/:adherence_log_id/confirm', requireAuth, idempotency, c.confirmAdherence);
