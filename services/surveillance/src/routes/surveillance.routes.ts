import { Router } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/surveillance.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const surveillanceRouter = Router();

surveillanceRouter.get('/surveillance/regional-insights', requireAuth, c.getRegionalInsights);
surveillanceRouter.get('/surveillance/reporting-areas', requireAuth, c.getReportingAreas);
surveillanceRouter.post('/surveillance/reporting-areas', requireAuth, c.importReportingAreas);
surveillanceRouter.post('/surveillance/regional-insights/releases', requireAuth, c.publishRegionalMonth);

surveillanceRouter.get('/surveillance/admin-analytics', requireAuth, c.getAdminAnalytics);

surveillanceRouter.get('/surveillance/conditions', requireAuth, c.getConditions);
surveillanceRouter.get('/surveillance/trends', requireAuth, c.getTrends);
