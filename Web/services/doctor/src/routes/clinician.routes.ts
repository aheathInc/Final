import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as controller from '../controllers/clinician.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});

const { requireAuth, requireRole, requireVerifiedClinician } = createAuthGuards(tokens);

export const clinicianRouter = Router();

// `me` routes are declared before `:clinician_id` so the literal wins the match.
clinicianRouter.get('/clinicians/me', requireAuth, requireRole('clinician'), controller.getMe);
clinicianRouter.put(
  '/clinicians/me/availability',
  requireAuth,
  requireVerifiedClinician,
  controller.setAvailability,
);
clinicianRouter.put(
  '/clinicians/me/slots',
  requireAuth,
  requireVerifiedClinician,
  controller.publishSlots,
);

// Any authenticated user may read a clinician's bookable slots — a patient
// choosing a time is the whole point of publishing them.
clinicianRouter.get('/clinicians/:clinician_id/slots', requireAuth, controller.listSlots);

clinicianRouter.get(
  '/clinicians',
  requireAuth,
  controller.list,
);
clinicianRouter.get('/clinicians/:clinician_id', requireAuth, controller.getOne);

clinicianRouter.post(
  '/clinicians/:clinician_id/verification',
  requireAuth,
  requireRole('platform_admin'),
  controller.decideVerification,
);
