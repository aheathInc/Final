import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/ai.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const aiRouter = Router();

aiRouter.post('/ai/conversations', requireAuth, idempotency, c.createConversation);
aiRouter.get('/ai/conversations/:conversation_id', requireAuth, c.getConversation);
aiRouter.post('/ai/conversations/:conversation_id/messages', requireAuth, idempotency, c.sendMessage);

aiRouter.post('/ai/triage', requireAuth, c.triage);
aiRouter.post('/ai/drug-interactions', requireAuth, c.drugInteractions);
aiRouter.post('/ai/transcribe', requireAuth, c.transcribe);
aiRouter.post('/ai/synthesize', requireAuth, c.synthesize);

aiRouter.get('/ai/models', requireAuth, requireRole('platform_admin'), c.listModels);
