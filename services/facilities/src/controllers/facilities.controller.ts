import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as facilities from '../services/facility.service.js';
import { facilityQueueQuery, listFacilitiesQuery } from '../types/facilities.types.js';

const handle =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json(await fn(req)); } catch (err) { next(err); }
  };

export const list = handle((req) => facilities.listFacilities(listFacilitiesQuery.parse(req.query)));
export const getOne = handle((req) => facilities.getFacility(pathParam(req, 'facility_id')));
export const departments = handle((req) => facilities.listDepartments(pathParam(req, 'facility_id')));
export const queue = handle((req) => {
  const query = facilityQueueQuery.parse(req.query);
  return facilities.getFacilityQueue(pathParam(req, 'facility_id'), query.department_id);
});
