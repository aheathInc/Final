import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as devices from '../services/device.service.js';
import { ingestTelemetry, raiseDeviceAlert } from '../services/telemetry.service.js';
import { ingestTelemetrySchema, raiseAlertSchema, registerDeviceSchema } from '../types/devices.types.js';

const caller = (req: Request) => ({ sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const register = handle(
  (req, res) => devices.registerDevice(caller(req), registerDeviceSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => devices.listDevices(caller(req)));

export const revoke = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await devices.revokeDevice(pathParam(req, 'device_id'), caller(req), meta(req, res));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const telemetry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ingestTelemetrySchema.parse(req.body);
    await ingestTelemetry(pathParam(req, 'device_id'), input.readings);
    res.status(202).end();
  } catch (err) {
    next(err);
  }
};

export const alert = handle(async (req) => {
  const input = raiseAlertSchema.parse(req.body);
  const result = await raiseDeviceAlert(pathParam(req, 'device_id'), input);
  return result ?? {};
}, 201);
