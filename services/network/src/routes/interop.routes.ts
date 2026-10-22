import { Router, type NextFunction, type Request, type Response } from 'express';
import { createAuthGuards, createIdempotency, createTokenService, forbidden } from '@a-health/http';
import { env } from '../config/env.js';
import { authenticateIntegration } from '../services/interop.service.js';
import * as c from '../controllers/interop.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

async function requireIntegration(req: Request, res: Response, next: NextFunction) {
  try {
    res.locals.interopSystem = await authenticateIntegration(
      req.header('X-Integration-System'), req.header('Authorization'),
    );
    next();
  } catch (error) { next(error ?? forbidden('FORBIDDEN', 'Integration client is not authorized')); }
}

export const interopRouter = Router();

interopRouter.get('/interop/systems', requireAuth, requireRole('platform_admin'), c.listSystems);
interopRouter.post('/interop/systems', requireAuth, requireRole('platform_admin'), idempotency, c.registerSystem);
interopRouter.post('/interop/systems/:system_id/activate', requireAuth, requireRole('platform_admin'), idempotency, c.activateSystem);
interopRouter.post('/interop/systems/:system_id/suspend', requireAuth, requireRole('platform_admin'), idempotency, c.suspendSystem);

interopRouter.get('/interop/identities/pending', requireAuth, requireRole('platform_admin'), c.listPendingIdentities);
interopRouter.post('/interop/identities/:identity_id/confirm', requireAuth, requireRole('platform_admin'), idempotency, c.confirmIdentity);
interopRouter.post('/interop/identities/:identity_id/mark-ambiguous', requireAuth, requireRole('platform_admin'), idempotency, c.markIdentityAmbiguous);
interopRouter.post('/interop/identities/:identity_id/reject', requireAuth, requireRole('platform_admin'), idempotency, c.rejectIdentity);

// Machine authentication is separate from patient/staff JWT auth. Tokens are
// read from process/secret-manager environment references and never returned.
interopRouter.post('/interop/fhir/import', requireIntegration, c.importFhirResource);

interopRouter.get('/interop/my-history', requireAuth, c.myTimeline);
interopRouter.get('/interop/patients/:patient_profile_id/timeline', requireAuth, c.patientTimeline);
interopRouter.get('/interop/records/:record_id', requireAuth, c.externalRecordDetail);
