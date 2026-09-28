import type { NextFunction, Request, Response } from 'express';
import { handleUssdSession } from '../services/ussd.service.js';
import { handleInboundSms } from '../services/sms.service.js';
import { smsInboundSchema, ussdSessionSchema } from '../types/gateway.types.js';

export async function ussdSession(req: Request, res: Response, next: NextFunction) {
  try {
    const input = ussdSessionSchema.parse(req.body);
    const result = await handleUssdSession(input.session_id, input.phone_number, input.text);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function smsInbound(req: Request, res: Response, next: NextFunction) {
  try {
    const input = smsInboundSchema.parse(req.body);
    // Accepted immediately; processing happens after the response so the
    // aggregator's own delivery timeout is never at the mercy of a
    // downstream service being slow.
    res.status(202).end();
    void handleInboundSms(input.from, input.text).catch(() => undefined);
  } catch (err) {
    next(err);
  }
}
