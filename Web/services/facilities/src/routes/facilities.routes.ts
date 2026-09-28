import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/facilities.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const facilitiesRouter = Router();

facilitiesRouter.get('/facilities', requireAuth, c.list);
facilitiesRouter.get('/facilities/:facility_id', requireAuth, c.getOne);
facilitiesRouter.get('/facilities/:facility_id/departments', requireAuth, c.departments);
facilitiesRouter.get('/facilities/:facility_id/queue', requireAuth, c.queue);
