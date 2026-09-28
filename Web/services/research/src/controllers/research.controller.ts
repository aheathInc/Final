import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as queries from '../services/query.service.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listDatasets = handle((req) => queries.listDatasets(caller(req)));

export const submitQuery = handle((req, res) => queries.submitQuery(caller(req), req.body, meta(req, res)), 202);

export const getQuery = handle((req) => queries.getQuery(pathParam(req, 'query_id'), caller(req)));
