import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/prevention.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const preventionRouter = Router();

preventionRouter.get('/patient-profiles/:patient_profile_id/risk-scores', requireAuth, c.listRiskScores);
preventionRouter.post('/patient-profiles/:patient_profile_id/risk-scores/compute', requireAuth, idempotency, c.computeRiskScores);

preventionRouter.get('/patient-profiles/:patient_profile_id/vaccinations', requireAuth, c.listVaccinations);
preventionRouter.post('/patient-profiles/:patient_profile_id/vaccinations', requireAuth, idempotency, c.recordVaccination);

preventionRouter.get('/screening-programmes', requireAuth, c.listProgrammes);
preventionRouter.get('/screening-invitations', requireAuth, c.listInvitations);
preventionRouter.post('/screening-invitations/:invitation_id/respond', requireAuth, idempotency, c.respond);
