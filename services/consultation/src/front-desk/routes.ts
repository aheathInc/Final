import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAuthGuards, createTokenService, pathParam } from '@a-health/http';
import { env } from '../config/env.js';
import * as service from './service.js';
import * as schema from './types.js';

const tokens = createTokenService({ secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS });
const { requireAuth, requireRole, requireVerifiedClinician } = createAuthGuards(tokens);
export const frontDeskRouter = Router();
frontDeskRouter.use('/front-desk', requireAuth);
const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid });
const meta = (req: Request, res: Response) => ({ ip: req.ip ?? null, requestId: res.locals.requestId as string | undefined });
const param = (req: Request, name: string) => schema.idSchema.parse(pathParam(req, name));
const handle = (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    // Health-related reads and POST responses must never be cached by an edge/browser.
    res.setHeader('Cache-Control', 'no-store');
    try { res.status(status).json(await fn(req, res)); } catch (error) { next(error); }
  };

frontDeskRouter.get('/front-desk/facilities', handle((req) => service.listDeskFacilities(caller(req), schema.directoryQuery.parse(req.query))));
frontDeskRouter.patch('/front-desk/facilities/:facility_id/policy', requireRole('platform_admin'), handle((req, res) =>
  service.configureDesk(caller(req), param(req, 'facility_id'), schema.policySchema.parse(req.body), meta(req, res))));
frontDeskRouter.get('/front-desk/facilities/:facility_id/departments', handle((req) =>
  service.listDeskDepartments(caller(req), param(req, 'facility_id'))));
frontDeskRouter.patch('/front-desk/facilities/:facility_id/departments/:department_id/navigation', requireRole('platform_admin'), handle((req, res) =>
  service.configureAliases(caller(req), param(req, 'facility_id'), param(req, 'department_id'), schema.aliasesSchema.parse(req.body), meta(req, res))));
// POST deliberately keeps free-text navigation input out of query strings/access URLs.
frontDeskRouter.post('/front-desk/facilities/:facility_id/navigation', handle((req) =>
  service.navigateDepartment(caller(req), param(req, 'facility_id'), schema.navigationSchema.parse(req.body).text)));
frontDeskRouter.get('/front-desk/facilities/:facility_id/departments/:department_id/queue', handle((req) =>
  service.getDepartmentBoard(caller(req), param(req, 'facility_id'), param(req, 'department_id'))));
frontDeskRouter.get('/front-desk/visits', requireRole('patient'), handle((req) => service.listMyVisits(caller(req), schema.visitListQuery.parse(req.query))));
// Stable request_key is durable in the same transaction as the ticket, not a time-limited middleware cache.
frontDeskRouter.post('/front-desk/visits', requireRole('patient'), handle((req, res) => service.createVisit(caller(req), schema.createVisitSchema.parse(req.body), meta(req, res)), 201));
frontDeskRouter.get('/front-desk/staff/visits', requireRole('platform_admin', 'clinician'), handle((req, res) =>
  service.listStaffVisits(caller(req), schema.staffListQuery.parse(req.query), meta(req, res))));
frontDeskRouter.get('/front-desk/visits/:visit_id', handle((req, res) => service.getVisit(caller(req), param(req, 'visit_id'), meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/check-in', requireRole('patient'), handle((req, res) =>
  service.checkInVisit(caller(req), param(req, 'visit_id'), schema.versionSchema.parse(req.body).base_version, meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/administrative-review', requireRole('platform_admin'), handle((req, res) =>
  service.administrativeReview(caller(req), param(req, 'visit_id'), schema.administrativeSchema.parse(req.body), meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/clinical-review', requireVerifiedClinician, handle((req, res) =>
  service.clinicalReview(caller(req), param(req, 'visit_id'), schema.clinicalSchema.parse(req.body), meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/call', requireVerifiedClinician, handle((req, res) =>
  service.callVisit(caller(req), param(req, 'visit_id'), schema.versionSchema.parse(req.body).base_version, meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/start', requireVerifiedClinician, handle((req, res) =>
  service.startVisit(caller(req), param(req, 'visit_id'), schema.versionSchema.parse(req.body).base_version, meta(req, res))));
frontDeskRouter.post('/front-desk/visits/:visit_id/cancel', requireRole('patient','clinician','platform_admin'), handle((req, res) =>
  service.cancelVisit(caller(req), param(req, 'visit_id'), schema.versionSchema.parse(req.body).base_version, meta(req, res))));
