import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as education from '../services/education.service.js';
import {
  createArticleSchema, createTopicSchema, getArticleQuery, listArticlesQuery, listTopicsQuery, publishArticleQuery,
} from '../types/education.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createTopic = handle(
  (req, res) => education.createTopic(caller(req), createTopicSchema.parse(req.body), meta(req, res)), 201,
);

export const listTopics = handle((req) => education.listTopics(listTopicsQuery.parse(req.query)));

export const createArticle = handle(
  (req, res) => education.createArticle(caller(req), createArticleSchema.parse(req.body), meta(req, res)), 201,
);

export const listArticles = handle((req) => education.listArticles(listArticlesQuery.parse(req.query)));

export const getArticle = handle((req) => {
  const query = getArticleQuery.parse(req.query);
  return education.getArticle(pathParam(req, 'slug'), query.language);
});

export const publishArticle = handle((req, res) => {
  const query = publishArticleQuery.parse(req.query);
  return education.publishArticle(pathParam(req, 'slug'), query.language, caller(req), meta(req, res));
});
