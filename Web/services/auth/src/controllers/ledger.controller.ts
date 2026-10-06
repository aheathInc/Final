import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import * as ledger from '../services/ledger.service.js';

const listQuery = z.object({
  category: z.enum(['consent', 'verification', 'break_glass']).optional(),
  cursor: z.string().regex(/^[1-9][0-9]*$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await ledger.listLedgerEvents(listQuery.parse(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function verify(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await ledger.verifyLedger());
  } catch (error) {
    next(error);
  }
}
