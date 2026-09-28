import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as risk from '../services/riskScore.service.js';
import * as vaccinations from '../services/vaccination.service.js';
import * as screening from '../services/screening.service.js';
import {
  computeRiskScoresSchema, listInvitationsQuery, recordVaccinationSchema, respondSchema,
} from '../types/prevention.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const listRiskScores = handle((req) =>
  risk.listRiskScores(pathParam(req, 'patient_profile_id'), caller(req)));

export const computeRiskScores = handle((req) => {
  const input = computeRiskScoresSchema.parse(req.body ?? {});
  return risk.computeRiskScores(pathParam(req, 'patient_profile_id'), caller(req), input.conditions);
});

export const listVaccinations = handle((req) =>
  vaccinations.listVaccinations(pathParam(req, 'patient_profile_id'), caller(req)));

export const recordVaccination = handle(
  (req, res) => vaccinations.recordVaccination(
    pathParam(req, 'patient_profile_id'), caller(req), recordVaccinationSchema.parse(req.body), meta(req, res),
  ), 201,
);

export const listProgrammes = handle(() => screening.listProgrammes());

export const listInvitations = handle((req) =>
  screening.listInvitations(caller(req), listInvitationsQuery.parse(req.query)));

export const respond = handle((req, res) => {
  const input = respondSchema.parse(req.body);
  const authHeader = req.header('Authorization') ?? '';
  return screening.respondToInvitation(pathParam(req, 'invitation_id'), caller(req), input, authHeader, meta(req, res));
});
