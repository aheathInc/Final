import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/pharmacy.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const pharmacyRouter = Router();

pharmacyRouter.get('/pharmacies', requireAuth, c.listPharmacies);
pharmacyRouter.get('/pharmacies/medication-search', requireAuth, c.searchMedication);

pharmacyRouter.post('/prescriptions/:prescription_id/dispense-code', requireAuth, idempotency, c.issueDispenseCode);
pharmacyRouter.post('/dispensing/verify', requireAuth, idempotency, c.verifyDispenseCode);
pharmacyRouter.post('/dispensing/:dispensing_id/complete', requireAuth, idempotency, c.completeDispensing);
