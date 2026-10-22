import type { NextFunction, Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import {
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  registerClinicianSchema,
  registerPatientSchema,
  setPasswordSchema,
  updateMeSchema,
} from '../types/auth.types.js';

const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

export async function registerPatient(req: Request, res: Response, next: NextFunction) {
  try {
    const input = registerPatientSchema.parse(req.body);
    // 202, not 201: the account exists but is unusable until the code is verified.
    res.status(202).json(await authService.registerPatient(input, meta(req, res)));
  } catch (err) {
    next(err);
  }
}

export async function registerClinician(req: Request, res: Response, next: NextFunction) {
  try {
    const input = registerClinicianSchema.parse(req.body);
    res.status(202).json(await authService.registerClinician(input, meta(req, res)));
  } catch (err) {
    next(err);
  }
}

export async function requestOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const input = otpRequestSchema.parse(req.body);
    res.status(200).json(await authService.requestOtp(input.phone_number, input.channel ?? 'sms'));
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const input = otpVerifySchema.parse(req.body);
    const session = await authService.verifyOtp(
      input.challenge_id,
      input.code,
      input.device_id,
      meta(req, res),
    );
    res.status(200).json(session);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = loginSchema.parse(req.body);
    res.status(200).json(await authService.login(input, meta(req, res)));
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const input = refreshSchema.parse(req.body);
    res.status(200).json(await authService.refreshSession(input.refresh_token, meta(req, res)));
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logout(req.auth!.sub, req.auth!.did, meta(req, res));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await authService.getMe(req.auth!.sub));
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const input = updateMeSchema.parse(req.body);
    res.status(200).json(await authService.updateMe(req.auth!.sub, input));
  } catch (err) {
    next(err);
  }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const input = setPasswordSchema.parse(req.body);
    await authService.setPassword(
      req.auth!.sub,
      req.auth!.amr,
      input.new_password,
      input.current_password,
      meta(req, res),
    );
    // 204 rather than a body: every session was just revoked, so there is
    // nothing useful to hand back. The client re-authenticates.
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
