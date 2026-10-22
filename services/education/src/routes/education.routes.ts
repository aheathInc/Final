import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/education.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const educationRouter = Router();

// Reading is public — health information must not be gated behind a login.
educationRouter.get('/education/topics', c.listTopics);
educationRouter.get('/education/articles', c.listArticles);
educationRouter.get('/education/articles/:slug', c.getArticle);

// Authoring requires a session and a clinician/admin role, enforced in the service layer.
educationRouter.post('/education/topics', requireAuth, idempotency, c.createTopic);
educationRouter.post('/education/articles', requireAuth, idempotency, c.createArticle);
educationRouter.post('/education/articles/:slug/publish', requireAuth, idempotency, c.publishArticle);
