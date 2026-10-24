import type { NextFunction, Request, Response } from 'express';
import * as surveillance from '../services/surveillance.service.js';
import { badRequest } from '@a-health/http';
import { getAdminAnalytics as fetchAdminAnalytics } from '../services/admin-analytics.service.js';
import { parseReportDays } from '../services/admin-analytics.policy.js';

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

export const getAdminAnalytics = handle((req) => {
  let days;
  try { days = parseReportDays(req.query.days); }
  catch { throw badRequest('VALIDATION_FAILED', 'days must be 30, 90 or 365', 'days'); }
  return fetchAdminAnalytics(req.auth!.role, days);
});
