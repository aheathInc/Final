import type { NextFunction, Request, Response } from 'express';
import * as surveillance from '../services/surveillance.service.js';
import { badRequest } from '@a-health/http';
import { getAdminAnalytics as fetchAdminAnalytics } from '../services/admin-analytics.service.js';
import { parseReportDays } from '../services/admin-analytics.policy.js';
import * as insights from '../services/regional-insights.service.js';
import { z } from 'zod';

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

const insightCaller = (req: Request) => ({ sub:req.auth!.sub,role:req.auth!.role });
export const getRegionalInsights = handle((req,res) => {
  res.setHeader('Cache-Control','no-store');
  return insights.getRegionalInsights(insightCaller(req), insights.reportQuery.parse(req.query));
});
export const getReportingAreas = handle(() => insights.listAreas());
export const importReportingAreas = handle(req => insights.importAreas(insightCaller(req), insights.importAreasSchema.parse(req.body)));
export const publishRegionalMonth = handle(req => insights.publishMonth(insightCaller(req), z.object({period:z.string()}).strict().parse(req.body).period));
