import type { NextFunction, Request, Response } from 'express';
import { pathParam, type EventBus } from '@a-health/http';
import * as messages from '../services/message.service.js';
import { issueTicket } from '../services/realtime.service.js';
import { createMessageSchema, listMessagesQuery, markReadSchema } from '../types/message.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
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

export function buildControllers(bus: EventBus) {
  return {
    list: handle((req) =>
      messages.listMessages(pathParam(req, 'care_thread_id'), caller(req), listMessagesQuery.parse(req.query))),

    create: handle(
      (req, res) => messages.createMessage(
        pathParam(req, 'care_thread_id'), caller(req),
        createMessageSchema.parse(req.body), bus, meta(req, res),
      ),
      201,
    ),

    markRead: handle((req) => {
      const input = markReadSchema.parse(req.body);
      return messages.markRead(pathParam(req, 'care_thread_id'), caller(req), input.up_to_message_id);
    }),

    realtimeToken: handle((req) => issueTicket(req.auth!.sub, req.auth!.did), 201),
  };
}
