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

// The plaintext reference is returned once; generic idempotency response caching
// would persist it and defeat the hash-only-at-rest design.
pharmacyRouter.post('/prescriptions/:prescription_id/dispense-code', requireAuth, c.issueDispenseCode);
pharmacyRouter.post('/prescriptions/:prescription_id/dispense-code/revoke', requireAuth, idempotency, c.revokeDispenseCode);
pharmacyRouter.get('/prescriptions/:prescription_id/fulfillment', requireAuth, c.getPrescriptionFulfillment);
pharmacyRouter.get('/pharmacist/me/pharmacies', requireAuth, c.listMyPharmacies);
// Verification includes minimum prescription details, so do not persist/replay its response body.
pharmacyRouter.post('/dispensing/verify', requireAuth, c.verifyDispenseCode);
pharmacyRouter.post('/dispensing/:dispensing_id/complete', requireAuth, idempotency, c.completeDispensing);
