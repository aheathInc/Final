import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/network.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const networkRouter = Router();

networkRouter.get('/network/communities', requireAuth, c.listCommunities);

networkRouter.get('/network/discussions', requireAuth, c.listDiscussions);
networkRouter.get('/network/discussions/:discussion_id', requireAuth, c.getDiscussion);
networkRouter.post('/network/discussions', requireAuth, idempotency, c.createDiscussion);
networkRouter.post('/network/discussions/:discussion_id/replies', requireAuth, idempotency, c.reply);

networkRouter.get('/network/second-opinions', requireAuth, c.listSecondOpinions);
networkRouter.post('/network/second-opinions', requireAuth, idempotency, c.requestSecondOpinion);
networkRouter.post('/network/second-opinions/:second_opinion_id/claim', requireAuth, idempotency, c.claimSecondOpinion);
networkRouter.post('/network/second-opinions/:second_opinion_id/answer', requireAuth, idempotency, c.answerSecondOpinion);
