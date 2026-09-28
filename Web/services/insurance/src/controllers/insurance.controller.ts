import type { NextFunction, Request, Response } from 'express';
import * as insurance from '../services/insurance.service.js';
import { getCoverageQuery, listClaimsQuery, submitClaimSchema } from '../types/insurance.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getCoverage = handle((req) => {
  const query = getCoverageQuery.parse(req.query);
  return insurance.getCoverage(caller(req), query.patient_profile_id);
});

export const submitClaim = handle(
  (req, res) => insurance.submitClaim(caller(req), submitClaimSchema.parse(req.body), meta(req, res)), 202,
);

export const listClaims = handle((req) => insurance.listClaims(caller(req), listClaimsQuery.parse(req.query)));
