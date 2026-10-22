import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as families from '../services/family.service.js';
import { addMemberSchema, assignDoctorsSchema, createFamilySchema } from '../types/families.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req, res) => families.createFamily(caller(req), createFamilySchema.parse(req.body), meta(req, res)), 201,
);

export const getMine = handle((req) => families.getMyFamily(caller(req)));

export const addMember = handle(
  (req, res) => families.addFamilyMember(pathParam(req, 'family_id'), caller(req), addMemberSchema.parse(req.body), meta(req, res)),
  201,
);

export const assignDoctors = handle(
  (req, res) => families.assignFamilyDoctors(pathParam(req, 'family_id'), caller(req), assignDoctorsSchema.parse(req.body), meta(req, res)),
);
