#!/usr/bin/env bash
#
# Writes the Phase 0 auth service into services/auth, following the structure
# already there. Existing files are backed up to *.bak before being replaced.
#
# Run from the repo root:
#   bash setup-auth-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/auth"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -d "$SVC/src" ] || { echo "services/auth/src not found."; exit 1; }

backup() { [ -f "$1" ] && [ -s "$1" ] && cp "$1" "$1.bak" && echo "  backed up $(basename "$1")" || true; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,middlewares,utils,types}
mkdir -p "$ROOT/packages/config/src"

echo "Writing auth service…"

# ---------------------------------------------------------------------------
backup "$ROOT/packages/config/src/index.ts"
cat > "$ROOT/packages/config/src/index.ts" << 'TS'
// Shared constants every service agrees on. package.json already pointed here;
// the file was missing, which would have broken the first service to import it.

export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

export const SERVICE_PORTS = {
  gateway: 8080,
  auth: 4001,
  patient: 4002,
  doctor: 4003,
  appointment: 4004,
  consultation: 4005,
  messaging: 4006,
  followup: 4007,
  notification: 4008,
} as const;

/** SLA window per urgency, in seconds. Mirrors the contract. */
export const SLA_SECONDS = {
  emergency: 180,
  urgent: 900,
  routine: 7200,
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const IDEMPOTENCY_TTL_HOURS = 24;
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/config/env.ts"
cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4001),
  SERVICE_NAME: z.string().default('auth'),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),

  // 15 minutes. Short enough that a revoked clinician cannot keep working for
  // long on a token minted before revocation.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  // 30 days, matching the contract. Rotated on every use.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().default(5),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  // Development only: return the OTP in the response so you can test without
  // an SMS provider. Refused when NODE_ENV is production.
  OTP_ECHO_IN_RESPONSE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.OTP_ECHO_IN_RESPONSE) {
  throw new Error('OTP_ECHO_IN_RESPONSE cannot be enabled in production.');
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/utils/errors.ts"
cat > "$SVC/src/utils/errors.ts" << 'TS'
/**
 * Error codes are a closed catalogue defined in packages/api. Clients branch on
 * `code`, never on `message`, so adding one is safe and repurposing one is not.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REUSE_DETECTED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'FORBIDDEN'
  | 'ROLE_NOT_PERMITTED'
  | 'NOT_RESOURCE_OWNER'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'STATE_TRANSITION_INVALID'
  | 'CLINICIAN_NOT_VERIFIED'
  | 'DUPLICATE_RESOURCE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly field?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (c: ErrorCode, m: string, f?: string) => new AppError(c, 400, m, f);
export const unauthenticated = (c: ErrorCode, m: string) => new AppError(c, 401, m);
export const forbidden = (c: ErrorCode, m: string) => new AppError(c, 403, m);
export const notFound = (m = 'Resource not found') => new AppError('NOT_FOUND', 404, m);
export const conflict = (c: ErrorCode, m: string, f?: string) => new AppError(c, 409, m, f);
export const unprocessable = (m: string, f?: string) =>
  new AppError('VALIDATION_FAILED', 422, m, f);
export const rateLimited = (m = 'Too many requests') => new AppError('RATE_LIMITED', 429, m);
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/utils/hash.ts"
cat > "$SVC/src/utils/hash.ts" << 'TS'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/** Stable stringify so the same object always hashes identically. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export const hashPayload = (value: unknown): string => sha256(canonical(value));

/** Opaque refresh token. Only its hash is ever persisted. */
export const generateOpaqueToken = (): string => randomBytes(32).toString('base64url');

/** Cryptographically uniform OTP — Math.random is not acceptable here. */
export function generateOtpCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10).toString();
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/utils/jwt.ts"
cat > "$SVC/src/utils/jwt.ts" << 'TS'
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthenticated } from './errors.js';

/**
 * HS256 with a shared secret. Every service that verifies a token can also
 * mint one, so a compromise anywhere is a compromise everywhere.
 *
 * The upgrade is RS256: auth holds the private key, everyone else holds the
 * public key and can verify but not sign. Only ALGORITHM and the key material
 * below change. Do it before the third service starts verifying tokens.
 */
const ALGORITHM = 'HS256' as const;

export interface AccessTokenClaims {
  sub: string;
  role: string;
  status: string;
  /** Patient profile id, when the subject is a patient. */
  ppid?: string;
  /** Clinician profile id, when the subject is a clinician. */
  cpid?: string;
  /**
   * Clinician verification status, denormalised so route guards do not hit the
   * database on every request. Bounded staleness: at most one access-token TTL
   * after an admin revokes a licence.
   */
  vst?: string;
  did?: string;
  jti: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AccessTokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated('TOKEN_EXPIRED', 'Access token has expired');
    }
    throw unauthenticated('TOKEN_INVALID', 'Access token is invalid');
  }
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/types/auth.types.ts"
cat > "$SVC/src/types/auth.types.ts" << 'TS'
import { z } from 'zod';

// E.164 only. A local-format number is rejected at the edge rather than
// normalised silently, so two records can never describe the same person.
export const phoneNumber = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be E.164, e.g. +255712345678');

export const languageCode = z.enum(['sw', 'en', 'fr', 'ha', 'am']);
export const channel = z.enum(['app', 'sms', 'ussd', 'voice', 'web']);
export const specialty = z.enum([
  'general_practice',
  'internal_medicine',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
  'psychiatry',
  'dermatology',
  'other',
]);

export const registerPatientSchema = z.object({
  phone_number: phoneNumber,
  full_name: z.string().max(150).optional(),
  preferred_language: languageCode,
  channel: channel.optional(),
});

export const registerClinicianSchema = z.object({
  phone_number: phoneNumber,
  full_name: z.string().min(1).max(150),
  email: z.string().email().max(150),
  license_number: z.string().min(1).max(50),
  specialty,
  languages_spoken: z.array(languageCode).optional(),
  preferred_language: languageCode,
  facility_id: z.string().uuid().optional(),
  verification_document_keys: z.array(z.string()).optional(),
});

export const otpRequestSchema = z.object({
  phone_number: phoneNumber,
  channel: channel.optional(),
});

export const otpVerifySchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  device_id: z.string().max(128).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_id: z.string().max(128).optional(),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const updateMeSchema = z.object({
  base_version: z.number().int(),
  full_name: z.string().max(150).optional(),
  preferred_language: languageCode.optional(),
  default_location: z
    .object({ lat: z.number(), lng: z.number(), accuracy_metres: z.number().optional() })
    .optional(),
  region_code: z.string().max(20).optional(),
});

export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;
export type RegisterClinicianInput = z.infer<typeof registerClinicianSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/middlewares/error.middleware.ts"
cat > "$SVC/src/middlewares/error.middleware.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      request_id: res.locals.requestId,
    },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.locals.requestId;

  if (err instanceof ZodError) {
    const first = err.issues[0];
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: first?.message ?? 'Request failed validation',
        field: first?.path.join('.'),
        details: { issues: err.issues },
        request_id: requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.field ? { field: err.field } : {}),
        ...(err.details ? { details: err.details } : {}),
        request_id: requestId,
      },
    });
    return;
  }

  // Unexpected. Log in full, but never leak internals to the caller — a stack
  // trace in a 500 body is an information disclosure.
  console.error(`[${requestId}] unhandled error`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: requestId,
      ...(env.NODE_ENV === 'development'
        ? { details: { message: (err as Error)?.message } }
        : {}),
    },
  });
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/middlewares/context.middleware.ts"
cat > "$SVC/src/middlewares/context.middleware.ts" << 'TS'
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Every request carries an id through the logs and back in the response. When
 * a patient reports that something failed yesterday afternoon, this is the
 * only thing that makes the failure findable.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('X-Request-ID') || randomUUID()).slice(0, 64);
  res.locals.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/middlewares/auth.middleware.ts"
cat > "$SVC/src/middlewares/auth.middleware.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessTokenClaims } from '../utils/jwt.js';
import { forbidden, unauthenticated } from '../utils/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    next(unauthenticated('UNAUTHENTICATED', 'Missing bearer token'));
    return;
  }
  try {
    req.auth = verifyAccessToken(header.slice(7).trim());
    if (req.auth.status !== 'active') {
      next(forbidden('FORBIDDEN', 'Account is not active'));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
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
}

/**
 * The guard that matters clinically. An unverified clinician must never accept
 * a consultation or sign a note, and hiding the button in the UI is not a
 * control — anyone can call the API directly.
 */
export function requireVerifiedClinician(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
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
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/middlewares/idempotency.middleware.ts"
cat > "$SVC/src/middlewares/idempotency.middleware.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { conflict, unprocessable } from '../utils/errors.js';
import { hashPayload } from '../utils/hash.js';

/**
 * Replays the first response for a given Idempotency-Key for 24 hours.
 *
 * This is what stops offline sync from creating duplicate clinical records: a
 * phone that queued a request, lost signal, and retried three times must
 * produce one appointment, not four.
 *
 * The insert itself is the lock. A concurrent retry loses the unique-constraint
 * race and is told to retry rather than executing in parallel.
 */
export function idempotency(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const key = req.header('Idempotency-Key');
      if (!key) {
        next(unprocessable('Idempotency-Key header is required', 'Idempotency-Key'));
        return;
      }

      const requestHash = hashPayload({ method: req.method, path: req.path, body: req.body });
      const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });

      if (existing) {
        if (existing.requestHash !== requestHash) {
          next(
            conflict(
              'IDEMPOTENCY_KEY_CONFLICT',
              'This Idempotency-Key was already used for a different request',
            ),
          );
          return;
        }
        if (existing.responseStatus !== null) {
          res.status(existing.responseStatus).json(existing.responseBody);
          return;
        }
        next(
          conflict('IDEMPOTENCY_KEY_CONFLICT', 'An identical request is still in flight'),
        );
        return;
      }

      try {
        await prisma.idempotencyRecord.create({
          data: {
            key,
            userId: req.auth?.sub ?? null,
            method: req.method,
            path: req.path,
            requestHash,
            lockedAt: new Date(),
            expiresAt: new Date(Date.now() + env.IDEMPOTENCY_TTL_HOURS * 3600_000),
          },
        });
      } catch {
        next(conflict('IDEMPOTENCY_KEY_CONFLICT', 'An identical request is still in flight'));
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        void prisma.idempotencyRecord
          .update({
            where: { key },
            data: {
              responseStatus: res.statusCode,
              responseBody: body as object,
              lockedAt: null,
            },
          })
          .catch((e) => console.error('idempotency persist failed', e));
        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  })();
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/services/audit.service.ts"
cat > "$SVC/src/services/audit.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { canonical, sha256 } from '../utils/hash.js';

const CHAIN_LOCK = 8471120325;

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends one hash-chained entry. Each row commits the hash of its predecessor,
 * so editing an old row breaks the chain and is detectable by replay. This is
 * the tamper-evident trail PDPA and clinical governance require.
 *
 * The advisory lock serialises appends. Without it two concurrent writers read
 * the same predecessor and fork the chain, which silently destroys the property
 * the whole structure exists for.
 */
export async function appendAudit(input: AuditInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK}::bigint)`;

    const last = await tx.auditLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });

    const createdAt = new Date();
    const payload = {
      prevHash: last?.hash ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
      createdAt: createdAt.toISOString(),
    };

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null,
        metadata: (input.metadata ?? {}) as object,
        prevHash: last?.hash ?? null,
        hash: sha256(canonical(payload)),
        createdAt,
      },
    });
  });
}

/** Walks the chain and reports the first row whose hash does not recompute. */
export async function verifyAuditChain(limit = 1000): Promise<{ ok: boolean; brokenAtSeq?: bigint }> {
  const rows = await prisma.auditLog.findMany({ orderBy: { seq: 'asc' }, take: limit });
  let prev: string | null = null;
  for (const row of rows) {
    const expected = sha256(
      canonical({
        prevHash: prev,
        actorUserId: row.actorUserId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        reason: row.reason,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt.toISOString(),
      }),
    );
    if (expected !== row.hash) return { ok: false, brokenAtSeq: row.seq };
    prev = row.hash;
  }
  return { ok: true };
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/services/changelog.service.ts"
cat > "$SVC/src/services/changelog.service.ts" << 'TS'
import type { Prisma } from '@prisma/client';

/**
 * Records one mutation for GET /sync/changes.
 *
 * Written from day one even though sync ships much later: a row that was never
 * logged can never be synced, so starting late would leave every early record
 * permanently invisible to offline clients.
 */
export async function recordChange(
  tx: Prisma.TransactionClient,
  input: {
    entity: string;
    entityId: string;
    op: 'create' | 'update' | 'delete';
    version: number;
    patientProfileId?: string | null;
    clinicianId?: string | null;
    careThreadId?: string | null;
  },
): Promise<void> {
  await tx.changeLog.create({
    data: {
      entity: input.entity,
      entityId: input.entityId,
      op: input.op,
      version: input.version,
      patientProfileId: input.patientProfileId ?? null,
      clinicianId: input.clinicianId ?? null,
      careThreadId: input.careThreadId ?? null,
    },
  });
}
TS

echo "  core files written"
echo
echo "Part 2 (auth.service, controller, routes, index) is in setup-auth-service-2.sh"
