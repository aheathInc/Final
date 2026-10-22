import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as investigations from '../services/investigation.service.js';
import {
  createOrderSchema, fileResultSchema, listOrdersQuery,
} from '../types/diagnostics.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req, res) => investigations.createOrder(caller(req), createOrderSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => investigations.listOrders(caller(req), listOrdersQuery.parse(req.query)));

export const getOne = handle((req) => investigations.getOrder(pathParam(req, 'order_id'), caller(req)));

export const fileResult = handle(
  (req, res) => investigations.fileResult(
    pathParam(req, 'order_id'), caller(req), fileResultSchema.parse(req.body), meta(req, res),
  ), 201,
);

export const acknowledge = handle(
  (req, res) => investigations.acknowledgeResult(pathParam(req, 'order_id'), caller(req), meta(req, res)),
);
