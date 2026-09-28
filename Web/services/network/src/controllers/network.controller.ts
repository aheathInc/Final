import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as discussions from '../services/discussion.service.js';
import * as opinions from '../services/secondOpinion.service.js';
import {
  answerSchema, createDiscussionSchema, listDiscussionsQuery, listSecondOpinionsQuery,
  replySchema, requestSecondOpinionSchema,
} from '../types/network.types.js';

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
