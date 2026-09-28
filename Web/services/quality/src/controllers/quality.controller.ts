import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as ratings from '../services/rating.service.js';
import * as incidents from '../services/incident.service.js';
import { createIncidentSchema, listIncidentsQuery, rateConsultationSchema } from '../types/quality.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const rate = handle(
  (req, res) => ratings.rateConsultation(pathParam(req, 'consultation_id'), caller(req), rateConsultationSchema.parse(req.body), meta(req, res)),
  201,
);

export const createIncident = handle(
  (req, res) => incidents.createIncidentReport(caller(req), createIncidentSchema.parse(req.body), meta(req, res)),
  201,
);

export const listIncidents = handle((req) => incidents.listIncidentReports(caller(req), listIncidentsQuery.parse(req.query)));
