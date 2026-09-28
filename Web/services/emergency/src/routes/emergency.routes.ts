import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/emergency.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole, optionalAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
const dispatcherOnly = requireRole('dispatcher', 'platform_admin');

export const emergencyRouter = Router();

// The one deliberate exception to requiring a session: reporting an
// emergency must never be blocked by an auth problem.
emergencyRouter.post('/emergency-requests', optionalAuth, idempotency, c.create);

emergencyRouter.get('/emergency-requests', requireAuth, c.list);
emergencyRouter.get('/emergency-requests/:emergency_id', requireAuth, c.getOne);
emergencyRouter.post('/emergency-requests/:emergency_id/dispatch', requireAuth, dispatcherOnly, idempotency, c.dispatch);
emergencyRouter.post('/emergency-requests/:emergency_id/status', requireAuth, dispatcherOnly, idempotency, c.setStatus);

emergencyRouter.get('/transport-units', requireAuth, dispatcherOnly, c.listUnits);
emergencyRouter.put('/transport-units/:unit_id/location', requireAuth, dispatcherOnly, c.updateLocation);
emergencyRouter.post('/transport-units/:unit_id/status', requireAuth, dispatcherOnly, c.setUnitStatus);
