import type { NextFunction, Request, Response } from 'express';
import { getSyncChanges } from '../services/changes.service.js';
import { applyBatch } from '../services/batch.service.js';
import { getChangesQuery, postBatchSchema } from '../types/sync.types.js';

export async function getChanges(req: Request, res: Response, next: NextFunction) {
  try {
    const query = getChangesQuery.parse(req.query);
    const caller = { sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid };
    res.status(200).json(await getSyncChanges(caller, query));
  } catch (err) {
    next(err);
  }
}

export async function postBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const input = postBatchSchema.parse(req.body);
    const authHeader = req.header('Authorization') ?? '';
    const results = await applyBatch(input.operations, authHeader);
    res.status(207).json({ results });
  } catch (err) {
    next(err);
  }
}
