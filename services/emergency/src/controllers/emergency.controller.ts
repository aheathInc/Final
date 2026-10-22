import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import {
  createEmergencySchema, dispatchSchema, listEmergenciesQuery, listUnitsQuery,
  setStatusSchema, setUnitStatusSchema, updateLocationSchema,
} from '../types/emergency.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role, ppid: req.auth?.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req) => emergencies.createEmergencyRequest(caller(req), createEmergencySchema.parse(req.body)), 201,
);

export const list = handle((req) =>
  emergencies.listEmergencyRequests(caller(req), listEmergenciesQuery.parse(req.query)));

export const getOne = handle((req) =>
  emergencies.getEmergencyRequest(pathParam(req, 'emergency_id'), caller(req)));

export const dispatch = handle((req, res) =>
  emergencies.dispatchEmergency(pathParam(req, 'emergency_id'), caller(req), dispatchSchema.parse(req.body), meta(req, res)));

export const setStatus = handle((req, res) =>
  emergencies.setEmergencyStatus(pathParam(req, 'emergency_id'), caller(req), setStatusSchema.parse(req.body), meta(req, res)));

export const listUnits = handle((req) => units.listTransportUnits(listUnitsQuery.parse(req.query)));

export const updateLocation = handle(async (req) => {
  await units.updateTransportLocation(pathParam(req, 'unit_id'), updateLocationSchema.parse(req.body));
  return undefined;
}, 204);

export const setUnitStatus = handle((req) => {
  const input = setUnitStatusSchema.parse(req.body);
  return units.setTransportStatus(pathParam(req, 'unit_id'), input.status);
});
