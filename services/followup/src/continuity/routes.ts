import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAuthGuards, createIdempotency, createTokenService, pathParam } from '@a-health/http';
import { env } from '../config/env.js';
import * as s from './service.js';
import * as v from './types.js';
const { requireAuth } = createAuthGuards(createTokenService({ secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS }));
const idem = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
const caller = (r: Request) => ({ sub: r.auth!.sub, role: r.auth!.role, ppid: r.auth!.ppid, cpid: r.auth!.cpid });
const resourceId = (r: Request) => v.resourceIdSchema.parse(pathParam(r, 'id'));
const meta = (r: Request, response: Response) => ({ ip: r.ip ?? null, requestId: (response.locals.requestId as string) ?? null });
const handle = (fn: (r: Request, response: Response) => Promise<unknown>) => async (r: Request, response: Response, next: NextFunction) => {
  try { response.setHeader('Cache-Control', 'no-store'); response.json(await fn(r, response)); } catch (error) { next(error); }
};
export const continuityRouter = Router();
continuityRouter.use('/care-continuity', requireAuth);
continuityRouter.get('/care-continuity/me', handle(r => s.patientOverview(caller(r), v.patientQuerySchema.parse(r.query))));
continuityRouter.post('/care-continuity/patients/:id/preferences', idem, handle((r, res) => s.updatePreference(caller(r), resourceId(r), v.preferenceSchema.parse(r.body), meta(r, res))));
continuityRouter.post('/care-continuity/reminders/:id/read', idem, handle(r => s.markRead(resourceId(r), caller(r))));
continuityRouter.get('/care-continuity/prescriptions', handle(r => s.medicationWorklist(caller(r), v.medicationQuerySchema.parse(r.query))));
continuityRouter.get('/care-continuity/worklist', handle(r => s.worklist(caller(r), v.worklistQuerySchema.parse(r.query))));
continuityRouter.get('/care-continuity/cycles/:id', handle(r => s.workDetail(resourceId(r), caller(r))));
continuityRouter.post('/care-continuity/items/:id/schedule', idem, handle((r, res) => s.saveSchedule(resourceId(r), caller(r), v.scheduleSchema.parse(r.body), meta(r, res))));
continuityRouter.post('/care-continuity/plans/:id/state', idem, handle((r, res) => s.changePlanState(resourceId(r), caller(r), v.planStateSchema.parse(r.body), meta(r, res))));
continuityRouter.post('/care-continuity/check-ins/:id/review', idem, handle((r, res) => s.reviewCheckIn(resourceId(r), caller(r), v.reviewSchema.parse(r.body), meta(r, res))));
continuityRouter.post('/care-continuity/cycles/:id/contacts', idem, handle((r, res) => s.scheduleContact(resourceId(r), caller(r), v.contactSchema.parse(r.body), meta(r, res))));
continuityRouter.post('/care-continuity/contacts/:id/outcome', idem, handle((r, res) => s.recordContact(resourceId(r), caller(r), v.contactOutcomeSchema.parse(r.body), meta(r, res))));
