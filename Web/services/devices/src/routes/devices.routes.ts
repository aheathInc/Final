import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { requireDeviceCredential } from '../middleware/deviceCredential.js';
import * as c from '../controllers/devices.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const devicesRouter = Router();

devicesRouter.post('/devices', requireAuth, idempotency, c.register);
devicesRouter.get('/devices', requireAuth, c.list);
devicesRouter.post('/devices/:device_id/revoke', requireAuth, c.revoke);

// Device-credential authenticated, not a user session.
devicesRouter.post('/devices/:device_id/telemetry', requireDeviceCredential, c.telemetry);
devicesRouter.post('/devices/:device_id/alerts', requireDeviceCredential, idempotency, c.alert);
