import type { NextFunction, Request, Response } from 'express';
import { notFound, pathParam } from '@a-health/http';
import * as profiles from '../services/profile.service.js';
import * as consents from '../services/consent.service.js';
import {
  createDependentSchema, grantConsentSchema, listQuery, updateProfileSchema,
} from '../types/patient.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getProfile = handle((req) =>
  profiles.getProfile(pathParam(req, 'patient_profile_id'), caller(req)));

export const getMyProfile = handle((req) => {
  const ppid = req.auth!.ppid;
  if (!ppid) throw notFound('No patient profile on this account');
  return profiles.getProfile(ppid, caller(req));
});

export const updateMyProfile = handle((req) => {
  const ppid = req.auth!.ppid;
  if (!ppid) throw notFound('No patient profile on this account');
  return profiles.updateProfile(ppid, caller(req), updateProfileSchema.parse(req.body));
});

export const updateProfile = handle((req) =>
  profiles.updateProfile(pathParam(req, 'patient_profile_id'), caller(req), updateProfileSchema.parse(req.body)));

export const listDependents = handle((req) =>
  profiles.listDependents(req.auth!.sub, listQuery.parse(req.query)));

export const createDependent = handle(
  (req, res) => profiles.createDependent(req.auth!.sub, createDependentSchema.parse(req.body), meta(req, res)),
  201,
);

export const listConsents = handle((req) =>
  consents.listConsents(pathParam(req, 'patient_profile_id'), caller(req)));

export const listConsentAuditHistory = handle((req) =>
  consents.listOwnAuditHistory(pathParam(req, 'patient_profile_id'), caller(req)));

export const grantConsent = handle(
  (req, res) => consents.grantConsent(
    pathParam(req, 'patient_profile_id'), caller(req), grantConsentSchema.parse(req.body), meta(req, res),
  ),
  201,
);

export const revokeConsent = handle((req, res) =>
  consents.revokeConsent(
    pathParam(req, 'patient_profile_id'), pathParam(req, 'consent_id'), caller(req), meta(req, res),
  ));
