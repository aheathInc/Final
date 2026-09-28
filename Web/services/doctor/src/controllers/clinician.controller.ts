import type { NextFunction, Request, Response } from 'express';
import { forbidden, pathParam } from '@a-health/http';
import * as clinicians from '../services/clinician.service.js';
import * as slots from '../services/slot.service.js';
import {
  availabilitySchema,
  listCliniciansQuery,
  publishSlotsSchema,
  slotsQuery,
  verificationDecisionSchema,
} from '../types/doctor.types.js';

const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

/** The clinician profile id lives on the token, so `me` needs no lookup. */
function ownProfileId(req: Request): string {
  const id = req.auth?.cpid;
  if (!id) throw forbidden('ROLE_NOT_PERMITTED', 'No clinician profile on this account');
  return id;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listCliniciansQuery.parse(req.query);
    res.status(200).json(await clinicians.listClinicians(query));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(
        await clinicians.getClinician(pathParam(req, 'clinician_id'), {
          sub: req.auth!.sub,
          role: req.auth!.role,
        }),
      );
  } catch (err) {
    next(err);
  }
}

export async function decideVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const input = verificationDecisionSchema.parse(req.body);
    res
      .status(200)
      .json(
        await clinicians.decideVerification(
          pathParam(req, 'clinician_id'),
          req.auth!.sub,
          input.decision,
          input.reason,
          meta(req, res),
        ),
      );
  } catch (err) {
    next(err);
  }
}

export async function setAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const input = availabilitySchema.parse(req.body);
    res
      .status(200)
      .json(
        await clinicians.setAvailability(
          ownProfileId(req),
          input.is_available,
          input.until,
          meta(req, res),
        ),
      );
  } catch (err) {
    next(err);
  }
}

export async function listSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const query = slotsQuery.parse(req.query);
    res.status(200).json(await slots.listSlots(pathParam(req, 'clinician_id'), query.from, query.to));
  } catch (err) {
    next(err);
  }
}

export async function publishSlots(req: Request, res: Response, next: NextFunction) {
  try {
    const input = publishSlotsSchema.parse(req.body);
    res.status(200).json(await slots.publishSlots(ownProfileId(req), input));
  } catch (err) {
    next(err);
  }
}
