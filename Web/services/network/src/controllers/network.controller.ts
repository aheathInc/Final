import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as discussions from '../services/discussion.service.js';
import * as opinions from '../services/secondOpinion.service.js';
import * as collaborations from '../services/collaboration.service.js';
import {
  answerSchema, createDiscussionSchema, listDiscussionsQuery, listSecondOpinionsQuery,
  replySchema, requestSecondOpinionSchema,
} from '../types/network.types.js';
import {
  collaborationMessageSchema, consultationIdQuery, listCollaborationsQuery,
  listMessagesQuery, requestCollaborationSchema,
} from '../types/collaboration.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listCommunities = handle(() => discussions.listCommunities());

export const listDiscussions = handle((req) => discussions.listDiscussions(listDiscussionsQuery.parse(req.query)));

export const getDiscussion = handle((req) => discussions.getDiscussion(pathParam(req, 'discussion_id')));

export const createDiscussion = handle(
  (req, res) => discussions.createDiscussion(caller(req), createDiscussionSchema.parse(req.body), meta(req, res)), 201,
);

export const reply = handle((req, res) => {
  const input = replySchema.parse(req.body);
  return discussions.replyToDiscussion(pathParam(req, 'discussion_id'), caller(req), input.body, meta(req, res));
}, 201);

export const requestSecondOpinion = handle(
  (req, res) => opinions.requestSecondOpinion(caller(req), requestSecondOpinionSchema.parse(req.body), meta(req, res)), 201,
);

export const listSecondOpinions = handle((req) => opinions.listSecondOpinions(listSecondOpinionsQuery.parse(req.query)));

export const claimSecondOpinion = handle(
  (req, res) => opinions.claimSecondOpinion(pathParam(req, 'second_opinion_id'), caller(req), meta(req, res)),
);

export const answerSecondOpinion = handle((req, res) => {
  const input = answerSchema.parse(req.body);
  return opinions.answerSecondOpinion(pathParam(req, 'second_opinion_id'), caller(req), input.answer, meta(req, res));
});

export const listCollaborativeCases = handle((req) =>
  collaborations.listCollaborativeCases(caller(req), listCollaborationsQuery.parse(req.query)));

export const listEligibleCollaborators = handle((req) => {
  const query = consultationIdQuery.parse(req.query);
  return collaborations.listEligibleClinicians(query.consultation_id, caller(req));
});

export const listCollaborations = handle((req) =>
  collaborations.listCollaborations(caller(req), listCollaborationsQuery.parse(req.query)));

export const requestCollaboration = handle((req, res) =>
  collaborations.requestCollaboration(caller(req), requestCollaborationSchema.parse(req.body), meta(req, res)), 201);

export const getCollaboration = handle((req) =>
  collaborations.getCollaboration(pathParam(req, 'collaboration_id'), caller(req)));

export const acceptCollaboration = handle((req, res) =>
  collaborations.acceptCollaboration(pathParam(req, 'collaboration_id'), caller(req), meta(req, res)));

export const declineCollaboration = handle((req, res) =>
  collaborations.declineCollaboration(pathParam(req, 'collaboration_id'), caller(req), meta(req, res)));

export const revokeCollaboration = handle((req, res) =>
  collaborations.revokeCollaboration(pathParam(req, 'collaboration_id'), caller(req), meta(req, res)));

export const getSharedCase = handle((req, res) =>
  collaborations.getSharedCase(pathParam(req, 'collaboration_id'), caller(req), meta(req, res)));

export const listCollaborationMessages = handle((req, res) =>
  collaborations.listCollaborationMessages(
    pathParam(req, 'collaboration_id'), caller(req), listMessagesQuery.parse(req.query), meta(req, res),
  ));

export const createCollaborationMessage = handle((req, res) => {
  const input = collaborationMessageSchema.parse(req.body);
  return collaborations.createCollaborationMessage(pathParam(req, 'collaboration_id'), caller(req), input.body, meta(req, res));
}, 201);
