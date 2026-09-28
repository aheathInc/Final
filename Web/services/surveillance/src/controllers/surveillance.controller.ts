import type { NextFunction, Request, Response } from 'express';
import * as surveillance from '../services/surveillance.service.js';

const caller = (req: Request) => ({ role: req.auth!.role });

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const getConditions = handle((req) => {
  const { level, area_code, from, to } = req.query as Record<string, string>;
  return surveillance.getConditions(caller(req), { level, area_code, from, to });
});

export const getTrends = handle((req) => {
  const { condition_code, level, area_code, from, to } = req.query as Record<string, string>;
  return surveillance.getTrends(caller(req), { condition_code, level, area_code, from, to });
});
