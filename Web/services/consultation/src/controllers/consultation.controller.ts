import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as threads from '../services/careThread.service.js';
import * as consultations from '../services/consultation.service.js';
import * as queue from '../services/queue.service.js';
import * as rulesets from '../services/ruleset.service.js';
import {
  closeThreadSchema, completeSchema, createConsultationSchema,
  declineSchema, listQuery, queueQuery, referSchema,
} from '../types/consultation.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub,
  role: req.auth!.role,
  ppid: req.auth!.ppid,
  cpid: req.auth!.cpid,
});

const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (err) {
      next(err);
    }
  };

export const listThreads = handle((req) =>
  threads.listCareThreads(caller(req), listQuery.parse(req.query)));

export const getThread = handle((req) =>
  threads.getCareThreadDetail(pathParam(req, 'care_thread_id'), caller(req)));

export const closeThread = handle((req) => {
  const input = closeThreadSchema.parse(req.body);
  return threads.closeCareThread(pathParam(req, 'care_thread_id'), caller(req), input.outcome, input.notes);
});

export const createConsultation = handle(
  (req, res) => consultations.createConsultation(caller(req), createConsultationSchema.parse(req.body), meta(req, res)),
  201,
);

export const acceptConsultation = handle((req, res) =>
  consultations.acceptConsultation(pathParam(req, 'consultation_id'), caller(req), meta(req, res)));

export const declineConsultation = handle((req, res) => {
  const input = declineSchema.parse(req.body ?? {});
  return consultations.declineConsultation(pathParam(req, 'consultation_id'), caller(req), input.reason, meta(req, res));
});

export const completeConsultation = handle((req, res) =>
  consultations.completeConsultation(pathParam(req, 'consultation_id'), caller(req), completeSchema.parse(req.body), meta(req, res)));

export const referConsultation = handle(
  (req, res) => consultations.referConsultation(pathParam(req, 'consultation_id'), caller(req), referSchema.parse(req.body), meta(req, res)),
  201,
);

export const getQueue = handle((req) => queue.getQueue(caller(req), queueQuery.parse(req.query)));

export const getQueueStatus = handle((req) =>
  queue.getQueueStatus(pathParam(req, 'consultation_id'), caller(req)));


export const getPrescription = handle((req) =>
  consultations.getPrescription(pathParam(req, 'prescription_id'), caller(req)));

export const listPatientPrescriptions = handle((req) =>
  consultations.listPatientPrescriptions(
    pathParam(req, 'patient_profile_id'), caller(req), listQuery.parse(req.query),
  ));


export const listTriageRulesets = handle((req) => rulesets.listRulesets(caller(req)));

export const getTriageRuleset = handle((req) =>
  rulesets.getRuleset(pathParam(req, 'label'), caller(req)));

export const createTriageRuleset = handle(
  (req, res) => rulesets.createDraft(caller(req), req.body, meta(req, res)), 201);

export const previewTriageRuleset = handle((req) =>
  rulesets.previewRuleset(pathParam(req, 'label'), caller(req), req.body?.sample));

export const activateTriageRuleset = handle((req, res) =>
  rulesets.activateRuleset(pathParam(req, 'label'), caller(req), req.body?.notes ?? '', meta(req, res)));


export const getConsultation = handle((req) =>
  consultations.getConsultation(pathParam(req, 'consultation_id'), caller(req)));

export const listConsultations = handle((req) =>
  consultations.listConsultations(caller(req), listQuery.parse(req.query)));

export const getConsultationNote = handle((req) =>
  consultations.getConsultationNote(pathParam(req, 'consultation_id'), caller(req)));

