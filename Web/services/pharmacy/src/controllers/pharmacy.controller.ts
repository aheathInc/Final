import type { NextFunction, Request, Response } from 'express';
import { pathParam, unprocessable } from '@a-health/http';
import * as pharmacies from '../services/pharmacy.service.js';
import * as dispensing from '../services/dispensing.service.js';
import {
  completeDispensingSchema, issueHandoffSchema, listPharmaciesQuery, searchMedicationQuery, verifyDispenseCodeSchema,
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

export const listMyPharmacies = handle((req) => dispensing.listMyPharmacies(caller(req)));

export const getPrescriptionFulfillment = handle((req) =>
  dispensing.getPrescriptionFulfillment(pathParam(req, 'prescription_id'), caller(req)));

export const issueDispenseCode = handle(
  (req, res) => {
    issueHandoffSchema.parse(req.body ?? {});
    return dispensing.issueDispenseCode(pathParam(req, 'prescription_id'), caller(req), meta(req, res));
  }, 201,
);

export const revokeDispenseCode = handle((req, res) =>
  dispensing.revokeDispenseCode(pathParam(req, 'prescription_id'), caller(req), meta(req, res)));

export const verifyDispenseCode = handle((req, res) => {
  const input = verifyDispenseCodeSchema.parse(req.body);
  return dispensing.verifyDispenseCode(input.reference, input.pharmacy_id, caller(req), meta(req, res));
});

export const completeDispensing = handle((req, res) => {
  const input = completeDispensingSchema.parse(req.body);
  if (req.get('Idempotency-Key') !== input.idempotency_key) {
    throw unprocessable('Idempotency-Key header must match the request body', 'idempotency_key');
  }
  return dispensing.completeDispensing(pathParam(req, 'dispensing_id'), caller(req), input, meta(req, res));
});
