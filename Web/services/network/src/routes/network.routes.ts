import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/network.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole, requireVerifiedClinician } = createAuthGuards(tokens);
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

// Patient-case sharing is a separate provider-only resource. It never opens
// the patient-facing care-thread messaging endpoints to a collaborator.
networkRouter.get('/network/collaborations/cases', requireAuth, requireVerifiedClinician, c.listCollaborativeCases);
networkRouter.get('/network/collaborations/eligible-clinicians', requireAuth, requireVerifiedClinician, c.listEligibleCollaborators);
networkRouter.get('/network/collaborations', requireAuth, requireVerifiedClinician, c.listCollaborations);
networkRouter.post('/network/collaborations', requireAuth, requireVerifiedClinician, idempotency, c.requestCollaboration);
networkRouter.post('/network/collaborations/:collaboration_id/accept', requireAuth, requireVerifiedClinician, idempotency, c.acceptCollaboration);
networkRouter.post('/network/collaborations/:collaboration_id/decline', requireAuth, requireVerifiedClinician, idempotency, c.declineCollaboration);
networkRouter.post('/network/collaborations/:collaboration_id/revoke', requireAuth, requireVerifiedClinician, idempotency, c.revokeCollaboration);
networkRouter.get('/network/collaborations/:collaboration_id/case', requireAuth, requireVerifiedClinician, c.getSharedCase);
networkRouter.get('/network/collaborations/:collaboration_id/messages', requireAuth, requireVerifiedClinician, c.listCollaborationMessages);
networkRouter.post('/network/collaborations/:collaboration_id/messages', requireAuth, requireVerifiedClinician, idempotency, c.createCollaborationMessage);
networkRouter.get('/network/collaborations/:collaboration_id', requireAuth, requireVerifiedClinician, c.getCollaboration);

// Digital referrals are independent records with a separate, exact facility
// consent. They do not inherit Phase A collaboration permission.
networkRouter.get('/referrals', requireAuth, requireRole('patient'), c.listPatientReferrals);
networkRouter.get('/referrals/cases', requireAuth, requireVerifiedClinician, c.listReferralCases);
networkRouter.get('/referrals/authorizations', requireAuth, requireVerifiedClinician, c.listReferralAuthorizations);
networkRouter.get('/referrals/source', requireAuth, requireVerifiedClinician, c.listSourceReferrals);
networkRouter.get('/referrals/inbox', requireAuth, requireVerifiedClinician, c.listInboxReferrals);
networkRouter.post('/referrals', requireAuth, requireVerifiedClinician, idempotency, c.createReferral);
networkRouter.get('/referrals/:referral_id/summary', requireAuth, c.getReferralSummary);
networkRouter.get('/referrals/:referral_id', requireAuth, c.getReferral);
networkRouter.post('/referrals/:referral_id/submit', requireAuth, requireVerifiedClinician, idempotency, c.submitReferral);
networkRouter.post('/referrals/:referral_id/receive', requireAuth, requireVerifiedClinician, idempotency, c.receiveReferral);
networkRouter.post('/referrals/:referral_id/accept', requireAuth, requireVerifiedClinician, idempotency, c.acceptReferral);
networkRouter.post('/referrals/:referral_id/decline', requireAuth, requireVerifiedClinician, idempotency, c.declineReferral);
networkRouter.post('/referrals/:referral_id/start-care', requireAuth, requireVerifiedClinician, idempotency, c.startReferralCare);
networkRouter.post('/referrals/:referral_id/complete', requireAuth, requireVerifiedClinician, idempotency, c.completeReferral);
networkRouter.post('/referrals/:referral_id/cancel', requireAuth, idempotency, c.cancelReferral);
