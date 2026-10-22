import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as checkins from '../services/checkin.service.js';
import * as adherence from '../services/adherence.service.js';
import { env } from '../config/env.js';
import {
  closeCycleSchema, confirmAdherenceSchema, listAdherenceQuery,
  listCheckInsQuery, respondSchema,
} from '../types/followup.types.js';

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

export const getCycle = handle((req) =>
  checkins.getCycle(pathParam(req, 'follow_up_cycle_id'), caller(req)));

export const listCheckIns = handle((req) =>
  checkins.listCheckIns(pathParam(req, 'follow_up_cycle_id'), caller(req), listCheckInsQuery.parse(req.query)));

export const respondToCheckIn = handle((req, res) =>
  checkins.respondToCheckIn(pathParam(req, 'check_in_id'), caller(req), respondSchema.parse(req.body), meta(req, res)));

export const closeCycle = handle((req, res) => {
  const input = closeCycleSchema.parse(req.body);
  return checkins.closeCycle(pathParam(req, 'follow_up_cycle_id'), caller(req), input.outcome, input.notes, meta(req, res));
});

export const listAdherence = handle((req) =>
  adherence.listAdherence(caller(req), listAdherenceQuery.parse(req.query)));

export const confirmAdherence = handle((req, res) =>
  adherence.confirmDose(
    pathParam(req, 'adherence_log_id'), caller(req), confirmAdherenceSchema.parse(req.body),
    env.ADHERENCE_MISS_THRESHOLD, meta(req, res),
  ));


export const listMyCheckIns = handle((req) =>
  checkins.listMyCheckIns(caller(req), listCheckInsQuery.parse(req.query)));

