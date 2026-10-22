import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthenticated } from '../errors.js';
import type { AccessTokenClaims, TokenService } from '../tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export interface AuthGuards {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireRole: (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => void;
  requireVerifiedClinician: (req: Request, res: Response, next: NextFunction) => void;
  /** Populates req.auth when a valid token is present; never rejects without one. */
  optionalAuth: (req: Request, res: Response, next: NextFunction) => void;
}

export function createAuthGuards(tokens: TokenService): AuthGuards {
  const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      next(unauthenticated('UNAUTHENTICATED', 'Missing bearer token'));
      return;
    }
    try {
      req.auth = tokens.verify(header.slice(7).trim());
      if (req.auth.status !== 'active') {
        next(forbidden('FORBIDDEN', 'Account is not active'));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireRole =
    (...roles: string[]) =>
    (req: Request, _res: Response, next: NextFunction): void => {
      if (!req.auth) {
        next(unauthenticated('UNAUTHENTICATED', 'Not authenticated'));
        return;
      }
      if (!roles.includes(req.auth.role)) {
        next(forbidden('ROLE_NOT_PERMITTED', 'Your role cannot perform this action'));
        return;
      }
      next();
    };

  /**
   * The guard that matters clinically. An unverified clinician must never
   * accept a consultation or sign a note, and hiding the button in the client
   * is not a control — anyone can call the API directly.
   */
  const requireVerifiedClinician = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated('UNAUTHENTICATED', 'Not authenticated'));
      return;
    }
    if (req.auth.role !== 'clinician') {
      next(forbidden('ROLE_NOT_PERMITTED', 'Clinician role required'));
      return;
    }
    if (req.auth.vst !== 'verified') {
      next(forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified'));
      return;
    }
    next();
  };

  /**
   * For the one class of write this platform allows without a session: reporting
   * an emergency. A bystander has no account and no time to create one. An
   * invalid or expired token here is treated as anonymous, not as an error —
   * the whole point is that reporting must never be blocked by an auth problem.
   */
  const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      next();
      return;
    }
    try {
      const claims = tokens.verify(header.slice(7).trim());
      if (claims.status === 'active') req.auth = claims;
    } catch {
      // fall through as anonymous
    }
    next();
  };

  return { requireAuth, requireRole, requireVerifiedClinician, optionalAuth };
}
