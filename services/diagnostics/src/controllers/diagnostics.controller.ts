import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as investigations from '../services/investigation.service.js';
import {
  createOrderSchema, fileResultSchema, listOrdersQuery,
  collectSchema, membershipQuery, membershipSchema,
} from '../types/diagnostics.types.js';
import * as laboratory from '../services/laboratory.service.js';

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

export const collect = handle((req, res) => investigations.collectSample(
  pathParam(req, 'order_id'), caller(req), collectSchema.parse(req.body).base_version, meta(req, res)));
export const labFacilities = handle(req => laboratory.laboratoryFacilities(caller(req)));
export const labMemberships = handle(req => laboratory.memberships(caller(req), membershipQuery.parse(req.query).facility_id));
export const labAssign = handle((req, res) => laboratory.assignMembership(caller(req), membershipSchema.parse(req.body), meta(req, res)));

// Recheck access before idempotency can return a cached patient-bearing response.
export async function checkLabOrderAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.auth!.role === 'lab_technician') await investigations.getOrder(pathParam(req, 'order_id'), caller(req));
    next();
  } catch (error) { next(error); }
}
