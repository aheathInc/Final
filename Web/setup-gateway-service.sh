#!/usr/bin/env bash
#
# Builds services/gateway — the USSD/SMS bridge (blueprint's low-connectivity
# access promise). This is the one service in the platform that talks to
# other services over HTTP instead of the shared database: it translates a
# key press or a text message into an ordinary authenticated API call — the
# exact same POST /consultations the app uses. There is exactly one
# implementation of the business rules; the channel never forks it.
#
# Honest scope for this pass: USSD/SMS require an EXISTING active account
# linked to the phone number. A first-time caller is told to register via the
# app or a facility, rather than the gateway re-implementing registration's
# own OTP flow inline — that would be exactly the kind of second
# implementation this design principle exists to prevent.
#
# Run from the repo root:
#   bash setup-gateway-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/gateway"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in UNAUTHENTICATED VALIDATION_FAILED NOT_FOUND; do
  if ! grep -q "'$code'" "$ERRORS"; then
    echo "  MISSING ERROR CODE: $code — stopping before writing anything that would fail tsc"
    exit 1
  fi
done
echo "  confirmed: all required error codes already exist in packages/http"

# ---------------------------------------------------------------------------
# packages/http: createService needs to accept a custom json-parser verify
# hook. Nothing else has needed raw bytes before -- every other service trusts
# a bearer token, not a body signature -- but HMAC verification is worthless
# against a body Express has already re-serialised. Small, backward-compatible
# addition: an optional field, defaulting to the same behaviour as before.
# ---------------------------------------------------------------------------
CREATESVC="$ROOT/packages/http/src/createService.ts"
if ! grep -q "jsonVerify" "$CREATESVC" 2>/dev/null; then
  node - "$CREATESVC" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

const old1 = '  onShutdown?: () => Promise<void>;\n}';
const new1 = '  onShutdown?: () => Promise<void>;\n  /** Passed through to express.json()\'s own `verify` option. Only used by services that need the exact raw bytes (e.g. HMAC verification) -- everything else leaves this unset. */\n  jsonVerify?: (req: unknown, res: unknown, buf: Buffer) => void;\n}';
if (!s.includes(old1)) { console.error('  ServiceOptions anchor not found'); process.exit(1); }
s = s.replace(old1, new1);

const old2 = "  app.use(express.json({ limit: '1mb' }));";
const new2 = "  app.use(express.json({ limit: '1mb', ...(options.jsonVerify ? { verify: options.jsonVerify as never } : {}) }));";
if (!s.includes(old2)) { console.error('  express.json() call anchor not found'); process.exit(1); }
s = s.replace(old2, new2);

fs.writeFileSync(p, s);
console.log('  packages/http: createService accepts jsonVerify');
NODE
else
  echo "  packages/http: createService already accepts jsonVerify"
fi


# ---------------------------------------------------------------------------
# packages/http: gateway HMAC verification, reusable middleware (same shape
# as the payment webhook's, a different header/secret).
# ---------------------------------------------------------------------------
GWMW="$ROOT/packages/http/src/middleware/gatewaySignature.ts"
if [ ! -f "$GWMW" ]; then
  cat > "$GWMW" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthenticated } from '../errors.js';

/**
 * Verifies the telecom aggregator's request the same way the payment
 * webhook verifies a provider's: HMAC of the raw body, compared in constant
 * time. `/gateway/*` is not part of the public API and carries no bearer
 * token — the aggregator does not have one, and one more shared secret is
 * simpler than standing up OAuth for a single upstream caller.
 */
export function createGatewaySignatureGuard(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('X-Gateway-Signature');
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!header || !raw) {
      next(unauthenticated('UNAUTHENTICATED', 'Missing gateway signature'));
      return;
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      next(unauthenticated('UNAUTHENTICATED', 'Gateway signature is not valid'));
      return;
    }
    next();
  };
}
TS
  echo "  packages/http: gatewaySignature middleware added"

  node - "$ROOT/packages/http/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("./middleware/gatewaySignature.js")) {
  s = s.replace(
    "export * from './middleware/idempotency.js';",
    "export * from './middleware/idempotency.js';\nexport * from './middleware/gatewaySignature.js';",
  );
  fs.writeFileSync(p, s);
  console.log('  packages/http: gatewaySignature exported from index');
}
NODE
else
  echo "  packages/http already has gatewaySignature"
fi

mkdir -p "$SVC/src"/{config,routes,controllers,services,middleware,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/gateway';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts' };
pkg.dependencies = { ...(pkg.dependencies || {}),
  '@a-health/database': 'workspace:*', '@a-health/http': 'workspace:*',
  '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2', express: '^5.1.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0',
  tsx: '^4.23.5', typescript: '^5.9.3' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4021),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  /** Deliberately short — an internal token minted for one USSD/SMS interaction, not a session. */
  INTERNAL_TOKEN_TTL_SECONDS: z.coerce.number().default(120),

  GATEWAY_SHARED_SECRET: z.string().min(16),

  CONSULTATION_SERVICE_URL: z.string().default('http://localhost:4005'),
  MESSAGING_SERVICE_URL: z.string().default('http://localhost:4006'),
  FOLLOWUP_SERVICE_URL: z.string().default('http://localhost:4007'),

  USSD_SESSION_TTL_SECONDS: z.coerce.number().default(180),
});

export const env = envSchema.parse(process.env);
TS

# --- internal auth: mint a token for the phone's linked account -------------
cat > "$SVC/src/services/internalAuth.ts" << 'TS'
import { prisma } from '@a-health/database';
import { createTokenService, type AccessTokenClaims } from '@a-health/http';
import { env } from '../config/env.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.INTERNAL_TOKEN_TTL_SECONDS,
});

/**
 * Resolves a phone number to its linked account and mints a normal access
 * token for it — the same shape every other login path produces. This is
 * what "the channel never forks the business rules" means in practice:
 * downstream services see an ordinary authenticated request, not a
 * special-cased USSD bypass.
 *
 * Returns null for an unrecognised or inactive phone. Registering a new
 * account belongs to auth's own OTP flow — reimplementing it here would be
 * the second business-rule path this design exists to prevent.
 */
export async function mintTokenForPhone(phoneNumber: string): Promise<{ token: string; claims: AccessTokenClaims } | null> {
  const user = await prisma.user.findUnique({
    where: { phoneNumber },
    include: { patientProfile: true, clinicianProfile: true },
  });
  if (!user || user.status !== 'active') return null;

  const claims: AccessTokenClaims = {
    sub: user.id,
    role: user.role,
    status: user.status,
    ppid: user.patientProfile?.id,
    cpid: user.clinicianProfile?.id,
    vst: user.clinicianProfile?.verificationStatus,
    amr: 'otp',
    jti: `gw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  return { token: tokens.sign(claims), claims };
}
TS

# --- internal HTTP client -----------------------------------------------------
cat > "$SVC/src/services/internalClient.ts" << 'TS'
import { createLogger } from '@a-health/logger';

const logger = createLogger('gateway.internal-client');

export interface InternalCallResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T | { error?: { code?: string; message?: string } };
}

/**
 * Calls another service exactly the way the app does: a bearer token, a
 * normal JSON body. No shared-secret shortcut, no direct-database bypass —
 * the whole point of minting a real token is that this call is
 * indistinguishable, on the receiving end, from one the app itself made.
 */
export async function callInternal<T = unknown>(
  baseUrl: string, path: string, method: 'GET' | 'POST', token: string, body?: unknown,
): Promise<InternalCallResult<T>> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `gw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: parsed as T };
  } catch (err) {
    logger.error('internal call failed', { baseUrl, path, err: String(err) });
    return { ok: false, status: 0, body: { error: { code: 'SERVICE_UNAVAILABLE', message: String(err) } } };
  }
}
TS

# --- USSD menu state machine --------------------------------------------------
cat > "$SVC/src/services/ussd.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { mintTokenForPhone } from './internalAuth.js';
import { callInternal } from './internalClient.js';

export interface UssdResult {
  response: string;
  terminate: boolean;
}

const MAIN_MENU =
  'A-Health\n1. Get medical help now\n2. Check my queue status\n0. Exit';

const NOT_REGISTERED =
  'This number is not registered. Download the A-Health app or visit a facility to register, then try again.';

/**
 * One interaction, one turn. The aggregator resends the FULL accumulated
 * input on every key press (its convention, not ours) — this only reads the
 * newest segment, since the session row already remembers where the caller
 * is in the tree.
 */
function lastSegment(text: string): string {
  const parts = text.split('*').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export async function handleUssdSession(
  sessionId: string, phoneNumber: string, text: string,
): Promise<UssdResult> {
  const now = new Date();
  let session = await prisma.ussdSession.findUnique({ where: { sessionId } });

  if (!session || session.expiresAt < now) {
    session = await prisma.ussdSession.upsert({
      where: { sessionId },
      create: {
        sessionId, phoneNumber, menuState: 'root', context: {},
        expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000),
      },
      update: {
        phoneNumber, menuState: 'root', context: {},
        expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000),
      },
    });
    if (!text || text.trim() === '') {
      return { response: MAIN_MENU, terminate: false };
    }
  }

  const choice = lastSegment(text);

  const advance = async (menuState: string, context: Record<string, unknown> = {}) => {
    await prisma.ussdSession.update({
      where: { sessionId },
      data: { menuState, context: { ...(session!.context as object), ...context } as never,
              expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000) },
    });
  };
  const end = async () => {
    await prisma.ussdSession.delete({ where: { sessionId } }).catch(() => undefined);
  };

  if (session.menuState === 'root') {
    if (choice === '1') {
      await advance('awaiting_symptoms');
      return { response: 'Briefly describe what is wrong (reply with text):', terminate: false };
    }
    if (choice === '2') {
      const auth = await mintTokenForPhone(phoneNumber);
      await end();
      if (!auth) return { response: NOT_REGISTERED, terminate: true };

      const result = await callInternal(
        env.CONSULTATION_SERVICE_URL, '/consultations?limit=1', 'GET', auth.token,
      );
      if (!result.ok) return { response: 'Could not check your status right now. Try again shortly.', terminate: true };
      return { response: 'Check the A-Health app for full queue details.', terminate: true };
    }
    if (choice === '0' || choice === '') {
      await end();
      return { response: 'Goodbye.', terminate: true };
    }
    return { response: MAIN_MENU, terminate: false };
  }

  if (session.menuState === 'awaiting_symptoms') {
    const symptomText = choice;
    const auth = await mintTokenForPhone(phoneNumber);
    await end();
    if (!auth) return { response: NOT_REGISTERED, terminate: true };
    if (!auth.claims.ppid) {
      return { response: 'Your account has no patient profile. Please use the app to continue.', terminate: true };
    }

    const result = await callInternal(
      env.CONSULTATION_SERVICE_URL, '/consultations', 'POST', auth.token,
      { channel: 'ussd', symptom_text: symptomText },
    );
    if (!result.ok) {
      return { response: 'Sorry, we could not submit your request. Please try again or visit a facility.', terminate: true };
    }
    return {
      response: 'Request received. A clinician will be with you shortly. You will get an SMS update.',
      terminate: true,
    };
  }

  await end();
  return { response: MAIN_MENU, terminate: false };
}
TS

# --- SMS keyword routing --------------------------------------------------
cat > "$SVC/src/services/sms.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { mintTokenForPhone } from './internalAuth.js';
import { callInternal } from './internalClient.js';
import { env } from '../config/env.js';

/**
 * Maps a keyword to the same internal call the app would make. A "1" or "2"
 * reply is read as confirming the caller's most recently due, still-open
 * dose reminder — the shape the AdherenceLog reminder template itself
 * prompts for. Anything unrecognised is not discarded: it is routed into
 * the patient's open care thread as an ordinary message, because a person
 * who took the trouble to text in deserves an answer, not silence.
 */
export async function handleInboundSms(from: string, text: string): Promise<void> {
  const auth = await mintTokenForPhone(from);
  if (!auth) return; // unregistered numbers are silently dropped, matching contract's 202-always-accepted shape

  const trimmed = text.trim();

  if ((trimmed === '1' || trimmed === '2') && auth.claims.ppid) {
    const pending = await prisma.adherenceLog.findFirst({
      where: { patientProfileId: auth.claims.ppid, reportedStatus: 'unreported' },
      orderBy: { scheduledAt: 'desc' },
    });
    if (pending) {
      await callInternal(
        env.FOLLOWUP_SERVICE_URL, `/adherence-logs/${pending.id}/confirm`, 'POST', auth.token,
        { reported_status: trimmed === '1' ? 'taken' : 'missed', channel: 'sms' },
      );
      return;
    }
  }

  if (auth.claims.ppid) {
    const thread = await prisma.careThread.findFirst({
      where: { patientProfileId: auth.claims.ppid, status: 'open' },
      orderBy: { updatedAt: 'desc' },
    });
    if (thread) {
      await callInternal(
        env.MESSAGING_SERVICE_URL, `/care-threads/${thread.id}/messages`, 'POST', auth.token,
        { body: text, channel: 'sms' },
      );
    }
  }
}
TS

# --- controller/routes -----------------------------------------------------
cat > "$SVC/src/types/gateway.types.ts" << 'TS'
import { z } from 'zod';

export const ussdSessionSchema = z.object({
  session_id: z.string().min(1),
  phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/),
  service_code: z.string().optional(),
  text: z.string().default(''),
});

export const smsInboundSchema = z.object({
  from: z.string().regex(/^\+[1-9]\d{7,14}$/),
  to: z.string().optional(),
  text: z.string(),
  received_at: z.string().datetime(),
  aggregator_message_id: z.string().optional(),
});
TS

cat > "$SVC/src/controllers/gateway.controller.ts" << 'TS'
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
TS

cat > "$SVC/src/routes/gateway.routes.ts" << 'TS'
import { Router } from 'express';
import { createGatewaySignatureGuard } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/gateway.controller.js';

const guard = createGatewaySignatureGuard(env.GATEWAY_SHARED_SECRET);

export const gatewayRouter = Router();

gatewayRouter.post('/gateway/ussd/session', guard, c.ussdSession);
gatewayRouter.post('/gateway/sms/inbound', guard, c.smsInbound);
TS

# --- raw-body capture, needed for HMAC verification --------------------------
cat > "$SVC/src/middleware/rawBody.ts" << 'TS'
/**
 * Captures the exact bytes Express received, before JSON parsing
 * re-serialises them differently than the sender did — required for HMAC
 * verification to match.
 *
 * Typed with `unknown` parameters to match createService's jsonVerify field
 * exactly: TypeScript checks function-typed properties contravariantly under
 * strict mode, so a version typed with Express's own Request/Response here
 * would fail to satisfy a field declared as accepting `unknown` — the cast
 * belongs inside the function body, not in a narrower parameter signature.
 */
export function captureRawBody(req: unknown, _res: unknown, buf: Buffer): void {
  (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
}
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { gatewayRouter } from './routes/gateway.routes.js';
import { captureRawBody } from './middleware/rawBody.js';

const service = createService({
  name: 'gateway',
  port: env.PORT,
  routers: [gatewayRouter],
  development: env.NODE_ENV === 'development',
  // The gateway is the one service whose caller (the telecom aggregator) has
  // no bearer token — it is authenticated by an HMAC over the raw request
  // body instead, which needs the exact bytes Express received before JSON
  // parsing re-serialises them differently than the sender did.
  jsonVerify: captureRawBody,
});

service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4021"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
    echo "GATEWAY_SHARED_SECRET=dev-gateway-secret-change-me"
    echo "CONSULTATION_SERVICE_URL=http://localhost:4005"
    echo "MESSAGING_SERVICE_URL=http://localhost:4006"
    echo "FOLLOWUP_SERVICE_URL=http://localhost:4007"
  } > "$SVC/.env"
  echo "  .env written"
fi

# --- tests --------------------------------------------------------------------
cat > "$SVC/src/tests/gateway.test.ts" << 'TS'
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { mintTokenForPhone } from '../services/internalAuth.js';
import { handleUssdSession } from '../services/ussd.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const sessionIds: string[] = [];

after(async () => {
  for (const id of sessionIds) {
    await prisma.ussdSession.deleteMany({ where: { sessionId: id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeActivePatient() {
  const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
  const user = await prisma.user.create({
    data: { phoneNumber: phone, role: 'patient', status: 'active', fullName: 'Gateway Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Gateway Test' } });
  return { phone, user, profile };
}

describe('internal auth', () => {
  it('mints a token for an active, registered phone', async () => {
    const { phone, profile } = await makeActivePatient();
    const auth = await mintTokenForPhone(phone);
    assert.ok(auth);
    assert.equal(auth!.claims.ppid, profile.id);
  });

  it('returns null for an unregistered phone', async () => {
    const auth = await mintTokenForPhone('+255700000000');
    assert.equal(auth, null);
  });

  it('returns null for a suspended account', async () => {
    const phone = `+2557${randomInt(10_000_000, 99_999_999)}`;
    const user = await prisma.user.create({ data: { phoneNumber: phone, role: 'patient', status: 'suspended', fullName: 'Suspended' } });
    users.push(user.id);

    const auth = await mintTokenForPhone(phone);
    assert.equal(auth, null);
  });
});

describe('ussd menu', () => {
  it('shows the main menu on a fresh session', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    const result = await handleUssdSession(sessionId, '+255700000001', '');
    assert.match(result.response, /A-Health/);
    assert.equal(result.terminate, false);
  });

  it('tells an unregistered caller to register, and ends the session', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    await handleUssdSession(sessionId, '+255700000002', '');
    const result = await handleUssdSession(sessionId, '+255700000002', '2');
    assert.match(result.response, /not registered/i);
    assert.equal(result.terminate, true);
  });

  it('keeps a fixed session-id string under the 182-character USSD reply limit', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    const result = await handleUssdSession(sessionId, '+255700000003', '');
    assert.ok(result.response.length <= 182);
  });

  it('expires and restarts a session past its TTL', async () => {
    const sessionId = `sess-${randomUUID()}`;
    sessionIds.push(sessionId);
    await handleUssdSession(sessionId, '+255700000004', '');
    await prisma.ussdSession.update({ where: { sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await handleUssdSession(sessionId, '+255700000004', '');
    assert.match(result.response, /A-Health/);
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/gateway exec tsc --noEmit"
echo "  pnpm --filter @a-health/gateway test"
