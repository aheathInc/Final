import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@a-health/database';
import { sha256, unauthenticated } from '@a-health/http';
import { pathParam } from '@a-health/http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: { id: string; patientProfileId: string | null };
    }
  }
}

/**
 * Telemetry and alerts are authenticated by the device's own credential, not
 * a user session — the contract is explicit about this, and it is the
 * correct choice: a fall is real whether or not a phone happens to be
 * logged in nearby. The credential is compared as a hash, the same pattern
 * as a pharmacy dispense code — shown once at registration, never stored or
 * transmitted in the clear again.
 */
export async function requireDeviceCredential(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const credential = req.header('X-Device-Credential');
  if (!credential) {
    next(unauthenticated('UNAUTHENTICATED', 'Missing device credential'));
    return;
  }
  const deviceId = pathParam(req, 'device_id');
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== 'active' || device.credentialHash !== sha256(credential)) {
    next(unauthenticated('UNAUTHENTICATED', 'Device credential is not valid'));
    return;
  }
  req.device = { id: device.id, patientProfileId: device.patientProfileId };
  next();
}
