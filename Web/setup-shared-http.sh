#!/usr/bin/env bash
#
# Creates packages/logger and packages/http — the shared kit every service
# from here on is built from.
#
# Everything in here currently lives inside services/auth. Extracting it before
# the second service exists is the whole point: copies drift, and an error
# envelope that differs slightly between two services is the kind of bug nobody
# finds until a client is parsing it.
#
# Run from the repo root:
#   bash setup-shared-http.sh
#
set -euo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

mkdir -p "$ROOT/packages/logger/src"
mkdir -p "$ROOT/packages/http/src/middleware"

# ===========================================================================
# packages/logger
# ===========================================================================
echo "Writing packages/logger…"

cat > "$ROOT/packages/logger/package.json" << 'JSON'
{
  "name": "@a-health/logger",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
JSON

cat > "$ROOT/packages/logger/src/index.ts" << 'TS'
/**
 * Structured JSON logging, no dependencies.
 *
 * One line per event so a log shipper can parse it, and — the part that
 * matters on a health platform — a redaction pass on every payload. An OTP,
 * a bearer token or a diagnosis reaching a log file is a disclosure that no
 * amount of access control on the database undoes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Redacted wherever they appear, at any depth. Add to this list rather than
 * remembering not to log something — the default has to be safe.
 */
const SECRET_KEYS = new Set([
  'password',
  'new_password',
  'current_password',
  'passwordhash',
  'code',
  'codehash',
  'otp',
  'dev_code',
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'authorization',
  'cookie',
  'signature',
  'secret',
  'jwt_secret',
  'mfasecret',
  'idempotency-key',
]);

/** Fields that identify a patient. Kept out of logs unless explicitly asked for. */
const PII_KEYS = new Set([
  'phone_number',
  'phonenumber',
  'email',
  'full_name',
  'fullname',
  'symptom_text',
  'symptomtext',
  'diagnosis_text',
  'diagnosistext',
  'advice_text',
  'body',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (SECRET_KEYS.has(key)) out[k] = '[redacted]';
    else if (PII_KEYS.has(key)) out[k] = '[pii]';
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  service: string,
  options: { level?: LogLevel; pretty?: boolean; bindings?: Record<string, unknown> } = {},
): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  const pretty = options.pretty ?? process.env.NODE_ENV === 'development';
  const bindings = options.bindings ?? {};
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = {
      time: new Date().toISOString(),
      level: lvl,
      service,
      message,
      ...bindings,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    const line = pretty
      ? `${entry.time} ${lvl.toUpperCase().padEnd(5)} [${service}] ${message} ${
          fields ? JSON.stringify(redact(fields)) : ''
        }`.trimEnd()
      : JSON.stringify(entry);
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (extra) =>
      createLogger(service, { level, pretty, bindings: { ...bindings, ...extra } }),
  };
}

export const redactForLog = redact;
TS

# ===========================================================================
# packages/http
# ===========================================================================
echo "Writing packages/http…"

cat > "$ROOT/packages/http/package.json" << 'JSON'
{
  "name": "@a-health/http",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@a-health/database": "workspace:*",
    "@a-health/logger": "workspace:*",
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.3",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.3",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^22.10.0",
    "typescript": "^5.9.3"
  }
}
JSON

# --- errors ----------------------------------------------------------------
cat > "$ROOT/packages/http/src/errors.ts" << 'TS'
/**
 * The single error-code catalogue, mirroring packages/api.
 *
 * Its value is that there is exactly one of it. When this lived inside a
 * service, the second service would have grown its own slightly different
 * copy, and clients branching on `code` would have had to learn both.
 *
 * Clients branch on `code`, never on `message`. Adding a code is a
 * non-breaking change; repurposing one is not.
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
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_TOO_WEAK'
  | 'CURRENT_PASSWORD_REQUIRED'
  | 'CURRENT_PASSWORD_INCORRECT'
  | 'FORBIDDEN'
  | 'ROLE_NOT_PERMITTED'
  | 'NOT_RESOURCE_OWNER'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'STATE_TRANSITION_INVALID'
  | 'CLINICIAN_NOT_VERIFIED'
  | 'CLINICIAN_UNAVAILABLE'
  | 'CONSULTATION_ALREADY_ASSIGNED'
  | 'CARE_THREAD_CLOSED'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_IN_PAST'
  | 'APPOINTMENT_NOT_YET_STARTABLE'
  | 'APPOINTMENT_ALREADY_STARTED'
  | 'CHECK_IN_ALREADY_ANSWERED'
  | 'FOLLOW_UP_CYCLE_CLOSED'
  | 'PRESCRIPTION_NOT_ACTIVE'
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
export const locked = (m: string) => new AppError('ACCOUNT_LOCKED', 423, m);
export const unprocessable = (m: string, f?: string) =>
  new AppError('VALIDATION_FAILED', 422, m, f);
export const rateLimited = (m = 'Too many requests') => new AppError('RATE_LIMITED', 429, m);
TS

# --- hash ------------------------------------------------------------------
cat > "$ROOT/packages/http/src/hash.ts" << 'TS'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/** Stable stringify, so the same object always hashes identically. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export const hashPayload = (value: unknown): string => sha256(canonical(value));

/** Opaque token. Only its hash is ever persisted. */
export const generateOpaqueToken = (): string => randomBytes(32).toString('base64url');

/** Cryptographically uniform. Math.random is not acceptable for a credential. */
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

# --- tokens ----------------------------------------------------------------
cat > "$ROOT/packages/http/src/tokens.ts" << 'TS'
import jwt from 'jsonwebtoken';
import { unauthenticated } from './errors.js';

/**
 * HS256 with a shared secret: every service that can verify a token can also
 * mint one, so a compromise anywhere is a compromise everywhere.
 *
 * The upgrade is RS256 — auth holds the private key, everyone else holds the
 * public key and can verify but not sign. Only ALGORITHM and the key material
 * change. Do it before a third service verifies tokens.
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
   * Clinician verification status, denormalised so route guards need no
   * database round trip. Bounded staleness: at most one access-token TTL after
   * an admin revokes a licence.
   */
  vst?: string;
  did?: string;
  /** How the session was established. Password changes depend on this. */
  amr?: 'otp' | 'password';
  jti: string;
}

export interface TokenConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface TokenService {
  sign(claims: AccessTokenClaims): string;
  verify(token: string): AccessTokenClaims;
}

export function createTokenService(config: TokenConfig): TokenService {
  return {
    sign: (claims) =>
      jwt.sign(claims, config.secret, {
        algorithm: ALGORITHM,
        expiresIn: config.ttlSeconds,
        issuer: config.issuer,
        audience: config.audience,
      }),
    verify: (token) => {
      try {
        return jwt.verify(token, config.secret, {
          algorithms: [ALGORITHM],
          issuer: config.issuer,
          audience: config.audience,
        }) as AccessTokenClaims;
      } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
          throw unauthenticated('TOKEN_EXPIRED', 'Access token has expired');
        }
        throw unauthenticated('TOKEN_INVALID', 'Access token is invalid');
      }
    },
  };
}
TS

# --- audit -----------------------------------------------------------------
cat > "$ROOT/packages/http/src/audit.ts" << 'TS'
import { prisma } from '@a-health/database';
import { canonical, sha256 } from './hash.js';

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
 * Appends one hash-chained entry. Each row commits the hash of its
 * predecessor, so editing an old row breaks the chain and is detectable by
 * replay — tamper evidence without a distributed ledger.
 *
 * The advisory lock serialises appends. Without it two concurrent writers read
 * the same predecessor and fork the chain, silently destroying the one
 * property the structure exists for.
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
export async function verifyAuditChain(
  limit = 1000,
): Promise<{ ok: boolean; brokenAtSeq?: bigint }> {
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

# --- changelog -------------------------------------------------------------
cat > "$ROOT/packages/http/src/changelog.ts" << 'TS'
import { prisma } from '@a-health/database';

/**
 * The transaction-scoped client, derived from the singleton rather than
 * imported from @prisma/client.
 *
 * Rule for every service: never import @prisma/client directly. Under pnpm
 * each package can resolve its own copy of the generated client, so a direct
 * import compiles today and breaks after the next install for no visible
 * reason.
 */
export type TxClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Records one mutation for GET /sync/changes.
 *
 * Called from day one even though sync ships much later: a row that was never
 * logged can never be synced, so starting late would leave every early record
 * permanently invisible to offline clients.
 */
export async function recordChange(
  tx: TxClient,
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

# --- middleware: context ---------------------------------------------------
cat > "$ROOT/packages/http/src/middleware/context.ts" << 'TS'
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
  res.locals.startedAt = Date.now();
  res.setHeader('X-Request-ID', requestId);
  next();
}
TS

# --- middleware: errors ----------------------------------------------------
cat > "$ROOT/packages/http/src/middleware/error.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '@a-health/logger';
import { AppError } from '../errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      request_id: res.locals.requestId,
    },
  });
}

export function createErrorHandler(logger: Logger, exposeInternals = false) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const requestId = res.locals.requestId as string | undefined;

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

    // Unexpected. Logged in full; never returned. A stack trace in a 500 body
    // is an information disclosure, and on this platform the stack can contain
    // a patient's data.
    logger.error('unhandled error', {
      requestId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        request_id: requestId,
        ...(exposeInternals ? { details: { message: (err as Error)?.message } } : {}),
      },
    });
  };
}
TS

# --- middleware: auth guards ----------------------------------------------
cat > "$ROOT/packages/http/src/middleware/auth.ts" << 'TS'
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

  return { requireAuth, requireRole, requireVerifiedClinician };
}
TS

# --- middleware: idempotency ----------------------------------------------
cat > "$ROOT/packages/http/src/middleware/idempotency.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@a-health/database';
import { conflict, unprocessable } from '../errors.js';
import { hashPayload } from '../hash.js';

/**
 * Replays the first response for a given Idempotency-Key.
 *
 * This is what stops offline sync creating duplicate clinical records: a phone
 * that queued a request, lost signal and retried three times must produce one
 * appointment, not four.
 *
 * The insert itself is the lock. A concurrent retry loses the unique-constraint
 * race and is told to retry rather than executing in parallel.
 */
export function createIdempotency(ttlHours = 24) {
  return (req: Request, res: Response, next: NextFunction): void => {
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
          next(conflict('IDEMPOTENCY_KEY_CONFLICT', 'An identical request is still in flight'));
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
              expiresAt: new Date(Date.now() + ttlHours * 3600_000),
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
            .catch(() => undefined);
          return originalJson(body);
        };

        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
TS

# --- createService ---------------------------------------------------------
cat > "$ROOT/packages/http/src/createService.ts" << 'TS'
import express, { type Express, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from '@a-health/database';
import { createLogger, type Logger } from '@a-health/logger';
import { requestContext } from './middleware/context.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.js';

export interface ServiceOptions {
  name: string;
  port: number;
  routers: Router[];
  development?: boolean;
  /** Extra dependency probes surfaced by GET /health. */
  healthChecks?: Record<string, () => Promise<boolean>>;
  onShutdown?: () => Promise<void>;
}

export interface Service {
  app: Express;
  logger: Logger;
  start(): void;
}

/**
 * Standard wiring for every service, so a new one is routes plus a call to
 * this rather than a hand-copied bootstrap that slowly diverges.
 *
 * Routers are mounted bare. The gateway prefixes /api/v1, so a service never
 * needs to know the public path it is served under.
 */
export function createService(options: ServiceOptions): Service {
  const development = options.development ?? process.env.NODE_ENV === 'development';
  const logger = createLogger(options.name);
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);

  // Structured access log. Deliberately no body: request payloads here carry
  // codes, tokens and clinical text.
  app.use((req, res, next) => {
    res.on('finish', () => {
      const started = res.locals.startedAt as number | undefined;
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: started ? Date.now() - started : undefined,
        requestId: res.locals.requestId,
        userId: req.auth?.sub,
      });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    void (async () => {
      const dependencies: Record<string, string> = {};
      let ok = true;
      try {
        await prisma.$queryRaw`SELECT 1`;
        dependencies.database = 'ok';
      } catch {
        dependencies.database = 'down';
        ok = false;
      }
      for (const [name, probe] of Object.entries(options.healthChecks ?? {})) {
        try {
          dependencies[name] = (await probe()) ? 'ok' : 'down';
        } catch {
          dependencies[name] = 'down';
        }
        if (dependencies[name] !== 'ok') ok = false;
      }
      res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', dependencies });
    })();
  });

  for (const router of options.routers) app.use(router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, development));

  return {
    app,
    logger,
    start() {
      const server = app.listen(options.port, () => {
        logger.info('listening', { port: options.port });
      });

      // Drain in-flight requests before exiting. Cutting a consultation write
      // in half on deploy is not acceptable.
      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
          logger.info('shutting down', { signal });
          server.close(() => {
            void (async () => {
              await options.onShutdown?.().catch(() => undefined);
              await prisma.$disconnect().catch(() => undefined);
              process.exit(0);
            })();
          });
        });
      }
    },
  };
}
TS

# --- barrel ----------------------------------------------------------------
cat > "$ROOT/packages/http/src/index.ts" << 'TS'
export * from './errors.js';
export * from './hash.js';
export * from './tokens.js';
export * from './audit.js';
export * from './changelog.js';
export * from './createService.js';
export * from './middleware/context.js';
export * from './middleware/error.js';
export * from './middleware/auth.js';
export * from './middleware/idempotency.js';
TS

for pkg in logger http; do
  cat > "$ROOT/packages/$pkg/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON
done

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/http exec tsc --noEmit"
echo
echo "Then run setup-auth-rewire.sh to point services/auth at the new package."
