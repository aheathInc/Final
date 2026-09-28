import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/appointment.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const appointmentRouter = Router();

appointmentRouter.post('/appointments', requireAuth, idempotency, c.create);
appointmentRouter.get('/appointments', requireAuth, c.list);
appointmentRouter.get('/appointments/:appointment_id', requireAuth, c.getOne);
appointmentRouter.post('/appointments/:appointment_id/start', requireAuth, idempotency, c.start);
appointmentRouter.post('/appointments/:appointment_id/cancel', requireAuth, idempotency, c.cancel);
