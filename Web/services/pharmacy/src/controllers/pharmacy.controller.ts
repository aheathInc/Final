import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as pharmacies from '../services/pharmacy.service.js';
import * as dispensing from '../services/dispensing.service.js';
import {
  completeDispensingSchema, listPharmaciesQuery, searchMedicationQuery, verifyDispenseCodeSchema,
} from '../types/pharmacy.types.js';

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

export const listPharmacies = handle((req) => pharmacies.listPharmacies(listPharmaciesQuery.parse(req.query)));

export const searchMedication = handle((req) => pharmacies.searchMedication(searchMedicationQuery.parse(req.query)));

export const issueDispenseCode = handle(
  (req, res) => dispensing.issueDispenseCode(pathParam(req, 'prescription_id'), caller(req), meta(req, res)), 201,
);

export const verifyDispenseCode = handle((req) => {
  const input = verifyDispenseCodeSchema.parse(req.body);
  return dispensing.verifyDispenseCode(input.code, input.pharmacy_id, caller(req));
});

export const completeDispensing = handle((req) => {
  const input = completeDispensingSchema.parse(req.body);
  return dispensing.completeDispensing(pathParam(req, 'dispensing_id'), caller(req), input.items);
});
