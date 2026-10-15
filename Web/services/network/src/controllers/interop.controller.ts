import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as interop from '../services/interop.service.js';
import {
  markAmbiguousSchema, reconcileIdentitySchema, registerExternalSystemSchema,
  rejectIdentitySchema, timelineQuerySchema,
} from '../types/interop.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, cpid: req.auth!.cpid, ppid: req.auth!.ppid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (error) { next(error); }
  };

export const listSystems = handle(() => interop.listSystems());
export const registerSystem = handle((req, res) =>
  interop.registerSystem(caller(req), registerExternalSystemSchema.parse(req.body), meta(req, res)), 201);
export const activateSystem = handle((req, res) =>
  interop.activateSystem(pathParam(req, 'system_id'), caller(req), meta(req, res)));
export const suspendSystem = handle((req, res) =>
  interop.suspendSystem(pathParam(req, 'system_id'), caller(req), meta(req, res)));
export const listPendingIdentities = handle(() => interop.listPendingIdentities());
export const confirmIdentity = handle((req, res) =>
  interop.confirmIdentity(pathParam(req, 'identity_id'), caller(req), reconcileIdentitySchema.parse(req.body), meta(req, res)));
export const markIdentityAmbiguous = handle((req, res) =>
  interop.markIdentityAmbiguous(pathParam(req, 'identity_id'), caller(req), markAmbiguousSchema.parse(req.body), meta(req, res)));
export const rejectIdentity = handle((req, res) =>
  interop.rejectIdentity(pathParam(req, 'identity_id'), caller(req), rejectIdentitySchema.parse(req.body), meta(req, res)));
export const importFhirResource = handle((req, res) => {
  const system = res.locals.interopSystem as { id: string; systemKey: string; supportedTypes: string[] };
  return interop.importFhirResource(system, req.body, meta(req, res));
}, 201);
export const myTimeline = handle((req, res) =>
  interop.getMyTimeline(caller(req), timelineQuerySchema.parse(req.query), meta(req, res)));
export const patientTimeline = handle((req, res) =>
  interop.getPatientTimeline(pathParam(req, 'patient_profile_id'), caller(req), timelineQuerySchema.parse(req.query), meta(req, res)));
export const externalRecordDetail = handle((req, res) =>
  interop.getExternalRecordDetail(pathParam(req, 'record_id'), caller(req), meta(req, res)));
