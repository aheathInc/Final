import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/patient.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const patientRouter = Router();

// The endpoint auth left for this service: identity is one service's concern,
// clinical profile data is this one's.
patientRouter.get('/users/me/dependents', requireAuth, c.listDependents);
patientRouter.post('/users/me/dependents', requireAuth, idempotency, c.createDependent);

patientRouter.get('/patient-profiles/me', requireAuth, c.getMyProfile);
patientRouter.patch('/patient-profiles/me', requireAuth, c.updateMyProfile);
patientRouter.get('/patient-profiles/:patient_profile_id', requireAuth, c.getProfile);
patientRouter.patch('/patient-profiles/:patient_profile_id', requireAuth, c.updateProfile);

patientRouter.get('/patient-profiles/:patient_profile_id/consents', requireAuth, c.listConsents);
patientRouter.post('/patient-profiles/:patient_profile_id/consents', requireAuth, idempotency, c.grantConsent);
patientRouter.post('/patient-profiles/:patient_profile_id/consents/:consent_id/revoke', requireAuth, c.revokeConsent);
