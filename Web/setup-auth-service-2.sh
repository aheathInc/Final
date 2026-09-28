#!/usr/bin/env bash
#
# Part 2. Run after setup-auth-service.sh, from the repo root:
#   bash setup-auth-service-2.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/auth"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SVC/src/utils/hash.ts" ] || { echo "Run setup-auth-service.sh first."; exit 1; }

backup() { [ -f "$1" ] && [ -s "$1" ] && cp "$1" "$1.bak" && echo "  backed up $(basename "$1")" || true; }

echo "Writing auth business logic…"

# ---------------------------------------------------------------------------
backup "$SVC/src/services/auth.service.ts"
cat > "$SVC/src/services/auth.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { signAccessToken } from '../utils/jwt.js';
import {
  generateOpaqueToken,
  generateOtpCode,
  sha256,
} from '../utils/hash.js';
import { conflict, forbidden, unauthenticated } from '../utils/errors.js';
import { appendAudit } from './audit.service.js';
import { recordChange } from './changelog.service.js';
import type {
  LoginInput,
  RegisterClinicianInput,
  RegisterPatientInput,
  UpdateMeInput,
} from '../types/auth.types.js';

const SALT_ROUNDS = 12;

export interface RequestMeta {
  ip?: string | null;
  requestId?: string | null;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}

async function issueOtp(
  userId: string | null,
  phoneNumber: string,
  purpose: string,
  channel: string,
) {
  const code = generateOtpCode(6);
  const challenge = await prisma.otpChallenge.create({
    data: {
      phoneNumber,
      codeHash: await bcrypt.hash(code, SALT_ROUNDS),
      deliveryChannel: channel as never,
      purpose,
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    },
  });

  // The notification service owns actual delivery. Until it exists the code is
  // logged in development only — it must never reach a production log.
  if (env.NODE_ENV === 'development') {
    console.log(`[dev] OTP for ${maskPhone(phoneNumber)} (${purpose}): ${code}`);
  }

  return {
    challenge,
    devCode: env.OTP_ECHO_IN_RESPONSE ? code : undefined,
    userId,
  };
}

function challengeResponse(
  challenge: { id: string; expiresAt: Date; deliveryChannel: string },
  phoneNumber: string,
  devCode?: string,
) {
  return {
    challenge_id: challenge.id,
    expires_at: challenge.expiresAt.toISOString(),
    delivery_channel: challenge.deliveryChannel,
    masked_destination: maskPhone(phoneNumber),
    ...(devCode ? { dev_code: devCode } : {}),
  };
}

async function enforceOtpRateLimit(phoneNumber: string): Promise<void> {
  const since = new Date(Date.now() - 3600_000);
  const recent = await prisma.otpChallenge.count({
    where: { phoneNumber, createdAt: { gte: since } },
  });
  if (recent >= env.OTP_REQUESTS_PER_HOUR) {
    // Deliberately the same shape whether or not the number is registered.
    throw new (await import('../utils/errors.js')).AppError(
      'RATE_LIMITED',
      429,
      'Too many verification codes requested. Try again later.',
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Always answers 202, whether or not the number is already registered. An
 * endpoint that distinguishes the two is a phone-number enumeration oracle,
 * and a list of numbers registered with a health platform is itself sensitive.
 */
export async function registerPatient(input: RegisterPatientInput, meta: RequestMeta) {
  await enforceOtpRateLimit(input.phone_number);

  const existing = await prisma.user.findUnique({ where: { phoneNumber: input.phone_number } });

  if (existing) {
    const { challenge, devCode } = await issueOtp(
      existing.id,
      input.phone_number,
      'login',
      input.channel ?? 'sms',
    );
    return challengeResponse(challenge, input.phone_number, devCode);
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phoneNumber: input.phone_number,
        role: 'patient',
        status: 'pending_verification',
        fullName: input.full_name ?? null,
        preferredLanguage: input.preferred_language,
      },
    });
    const profile = await tx.patientProfile.create({
      data: { userId: created.id, fullName: input.full_name ?? 'Unnamed patient' },
    });
    await recordChange(tx, {
      entity: 'patient_profiles',
      entityId: profile.id,
      op: 'create',
      version: profile.version,
      patientProfileId: profile.id,
    });
    return created;
  });

  await appendAudit({
    actorUserId: user.id,
    action: 'patient.registered',
    entityType: 'users',
    entityId: user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  const { challenge, devCode } = await issueOtp(
    user.id,
    input.phone_number,
    'registration',
    input.channel ?? 'sms',
  );
  return challengeResponse(challenge, input.phone_number, devCode);
}

/**
 * A clinician account is created inert. It cannot accept a consultation or sign
 * a note until an admin approves the licence, and that check lives on the
 * server rather than in the clinician app.
 */
export async function registerClinician(input: RegisterClinicianInput, meta: RequestMeta) {
  const clash = await prisma.user.findFirst({
    where: { OR: [{ phoneNumber: input.phone_number }, { email: input.email }] },
  });
  if (clash) throw conflict('DUPLICATE_RESOURCE', 'Phone number or email is already registered');

  const licenceClash = await prisma.clinicianProfile.findUnique({
    where: { licenseNumber: input.license_number },
  });
  if (licenceClash) {
    throw conflict('DUPLICATE_RESOURCE', 'Licence number is already registered', 'license_number');
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phoneNumber: input.phone_number,
        email: input.email,
        role: 'clinician',
        status: 'pending_verification',
        fullName: input.full_name,
        preferredLanguage: input.preferred_language,
      },
    });
    await tx.clinicianProfile.create({
      data: {
        userId: created.id,
        licenseNumber: input.license_number,
        specialty: input.specialty,
        verificationStatus: 'pending',
        facilityId: input.facility_id ?? null,
        languagesSpoken: input.languages_spoken ?? [],
        verificationDocs: input.verification_document_keys ?? [],
      },
    });
    return created;
  });

  await appendAudit({
    actorUserId: user.id,
    action: 'clinician.registered',
    entityType: 'users',
    entityId: user.id,
    metadata: { specialty: input.specialty },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  const { challenge, devCode } = await issueOtp(
    user.id,
    input.phone_number,
    'registration',
    'sms',
  );
  return challengeResponse(challenge, input.phone_number, devCode);
}

// ---------------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------------

export async function requestOtp(phoneNumber: string, channel: string) {
  await enforceOtpRateLimit(phoneNumber);
  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  // No user? Still burn a challenge and answer identically. The caller cannot
  // tell registered numbers from unregistered ones.
  const { challenge, devCode } = await issueOtp(user?.id ?? null, phoneNumber, 'login', channel);
  return challengeResponse(challenge, phoneNumber, user ? devCode : undefined);
}

export async function verifyOtp(
  challengeId: string,
  code: string,
  deviceId: string | undefined,
  meta: RequestMeta,
) {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw unauthenticated('OTP_INVALID', 'Verification code is not valid');
  if (challenge.consumedAt) throw unauthenticated('OTP_INVALID', 'Code has already been used');
  if (challenge.expiresAt < new Date()) {
    throw unauthenticated('OTP_EXPIRED', 'Verification code has expired');
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw unauthenticated('OTP_ATTEMPTS_EXCEEDED', 'Too many attempts. Request a new code.');
  }

  const matches = await bcrypt.compare(code, challenge.codeHash);
  if (!matches) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    // Exhausting the attempts kills the challenge outright rather than leaving
    // it open to further guessing.
    if (updated.attempts >= updated.maxAttempts) {
      await prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { consumedAt: new Date() },
      });
      throw unauthenticated('OTP_ATTEMPTS_EXCEEDED', 'Too many attempts. Request a new code.');
    }
    throw unauthenticated('OTP_INVALID', 'Verification code is not valid');
  }

  const user = await prisma.user.findUnique({
    where: { phoneNumber: challenge.phoneNumber },
    include: { patientProfile: true, clinicianProfile: true },
  });
  if (!user) throw unauthenticated('OTP_INVALID', 'Verification code is not valid');

  await prisma.otpChallenge.update({
    where: { id: challengeId },
    data: { consumedAt: new Date() },
  });

  // A clinician stays pending_verification until an admin approves the licence.
  // Verifying a phone number proves possession of a handset, not a right to
  // practise medicine.
  if (user.status === 'pending_verification' && user.role === 'patient') {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'active', version: { increment: 1 } },
    });
    user.status = 'active';
  }

  if (user.status === 'suspended' || user.status === 'deactivated') {
    throw forbidden('FORBIDDEN', 'This account is not active');
  }

  await appendAudit({
    actorUserId: user.id,
    action: 'auth.otp_verified',
    entityType: 'users',
    entityId: user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return issueSession(user, deviceId);
}

// ---------------------------------------------------------------------------
// Password login, sessions
// ---------------------------------------------------------------------------

export async function login(input: LoginInput, meta: RequestMeta) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { patientProfile: true, clinicianProfile: true },
  });

  // One generic failure for wrong email, wrong password, and patient accounts,
  // so the response never reveals which of the three it was.
  const invalid = () => unauthenticated('UNAUTHENTICATED', 'Email or password is incorrect');

  if (!user || !user.passwordHash || user.role === 'patient') throw invalid();
  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    await appendAudit({
      actorUserId: user.id,
      action: 'auth.login_failed',
      entityType: 'users',
      entityId: user.id,
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
    throw invalid();
  }
  if (user.status !== 'active') throw forbidden('FORBIDDEN', 'This account is not active');

  await appendAudit({
    actorUserId: user.id,
    action: 'auth.login',
    entityType: 'users',
    entityId: user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return issueSession(user, input.device_id);
}

type UserWithProfiles = {
  id: string;
  role: string;
  status: string;
  patientProfile?: { id: string } | null;
  clinicianProfile?: { id: string; verificationStatus: string } | null;
};

async function issueSession(
  user: UserWithProfiles,
  deviceId?: string,
  familyId = randomUUID(),
) {
  const refreshToken = generateOpaqueToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId,
      deviceId: deviceId ?? null,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    status: user.status,
    ppid: user.patientProfile?.id,
    cpid: user.clinicianProfile?.id,
    vst: user.clinicianProfile?.verificationStatus,
    did: deviceId,
    jti: randomUUID(),
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer' as const,
    expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Rotates the refresh token. Presenting one that was already used means either
 * the client replayed, or a stolen token is in circulation; both are handled by
 * revoking the entire family and forcing a fresh login.
 */
export async function refreshSession(presented: string, meta: RequestMeta) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(presented) },
    include: {
      user: { include: { patientProfile: true, clinicianProfile: true } },
    },
  });

  if (!record || record.revokedAt) {
    throw unauthenticated('TOKEN_INVALID', 'Refresh token is not valid');
  }

  if (record.usedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await appendAudit({
      actorUserId: record.userId,
      action: 'auth.refresh_reuse_detected',
      entityType: 'refresh_tokens',
      entityId: record.id,
      metadata: { familyId: record.familyId },
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
    throw unauthenticated('TOKEN_REUSE_DETECTED', 'Session revoked. Please sign in again.');
  }

  if (record.expiresAt < new Date()) {
    throw unauthenticated('TOKEN_EXPIRED', 'Refresh token has expired');
  }
  if (record.user.status !== 'active') {
    throw forbidden('FORBIDDEN', 'This account is not active');
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return issueSession(record.user, record.deviceId ?? undefined, record.familyId);
}

export async function logout(userId: string, deviceId: string | undefined, meta: RequestMeta) {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(deviceId ? { deviceId } : {}),
    },
    data: { revokedAt: new Date() },
  });

  await appendAudit({
    actorUserId: userId,
    action: 'auth.logout',
    entityType: 'users',
    entityId: userId,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function serialiseUser(user: {
  id: string;
  role: string;
  status: string;
  fullName: string | null;
  phoneNumber: string;
  email: string | null;
  preferredLanguage: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  patientProfile?: {
    id: string;
    fullName: string;
    dateOfBirth: Date | null;
    sex: string | null;
    regionCode: string | null;
    version: number;
    updatedAt: Date;
  } | null;
  clinicianProfile?: {
    id: string;
    specialty: string;
    verificationStatus: string;
    isAvailable: boolean;
    currentLoad: number;
    version: number;
    updatedAt: Date;
  } | null;
}) {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    email: user.email,
    preferred_language: user.preferredLanguage,
    ...(user.patientProfile
      ? {
          patient_profile: {
            id: user.patientProfile.id,
            full_name: user.patientProfile.fullName,
            date_of_birth: user.patientProfile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
            sex: user.patientProfile.sex,
            region_code: user.patientProfile.regionCode,
            version: user.patientProfile.version,
            updated_at: user.patientProfile.updatedAt.toISOString(),
          },
        }
      : {}),
    ...(user.clinicianProfile
      ? {
          clinician_profile: {
            id: user.clinicianProfile.id,
            specialty: user.clinicianProfile.specialty,
            verification_status: user.clinicianProfile.verificationStatus,
            is_available: user.clinicianProfile.isAvailable,
            current_load: user.clinicianProfile.currentLoad,
            version: user.clinicianProfile.version,
            updated_at: user.clinicianProfile.updatedAt.toISOString(),
          },
        }
      : {}),
    version: user.version,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { patientProfile: true, clinicianProfile: true },
  });
  return serialiseUser(user);
}

export async function updateMe(userId: string, input: UpdateMeInput) {
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { patientProfile: true },
  });

  // Optimistic concurrency. Two devices editing the same profile offline must
  // not have one silently overwrite the other.
  if (current.version !== input.base_version) {
    throw conflict('VERSION_CONFLICT', 'This profile was changed elsewhere. Reload and retry.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
        ...(input.preferred_language ? { preferredLanguage: input.preferred_language } : {}),
        version: { increment: 1 },
      },
      include: { patientProfile: true, clinicianProfile: true },
    });

    if (current.patientProfile && (input.default_location || input.region_code)) {
      const profile = await tx.patientProfile.update({
        where: { id: current.patientProfile.id },
        data: {
          ...(input.default_location
            ? {
                defaultLat: input.default_location.lat,
                defaultLng: input.default_location.lng,
              }
            : {}),
          ...(input.region_code ? { regionCode: input.region_code } : {}),
          version: { increment: 1 },
        },
      });
      await recordChange(tx, {
        entity: 'patient_profiles',
        entityId: profile.id,
        op: 'update',
        version: profile.version,
        patientProfileId: profile.id,
      });
    }

    return user;
  });

  return serialiseUser(updated);
}
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/controllers/auth.controller.ts"
cat > "$SVC/src/controllers/auth.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import {
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  registerClinicianSchema,
  registerPatientSchema,
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
    res.status(202).json(await authService.requestOtp(input.phone_number, input.channel ?? 'sms'));
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
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/routes/auth.routes.ts"
cat > "$SVC/src/routes/auth.routes.ts" << 'TS'
import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { idempotency } from '../middlewares/idempotency.middleware.js';

export const authRouter = Router();

// Registration creates state, so it carries Idempotency-Key. A phone that
// retried three times over a bad connection must produce one account.
authRouter.post('/auth/register/patient', idempotency, controller.registerPatient);
authRouter.post('/auth/register/clinician', idempotency, controller.registerClinician);

// OTP request is naturally repeatable and rate limited instead.
authRouter.post('/auth/otp/request', controller.requestOtp);
authRouter.post('/auth/otp/verify', controller.verifyOtp);

authRouter.post('/auth/login', controller.login);
authRouter.post('/auth/token/refresh', controller.refresh);
authRouter.post('/auth/logout', requireAuth, controller.logout);

export const userRouter = Router();

userRouter.get('/users/me', requireAuth, controller.getMe);
userRouter.patch('/users/me', requireAuth, controller.updateMe);

// /users/me/dependents belongs to services/patient — this service owns
// identity, not clinical profile management.
TS

# ---------------------------------------------------------------------------
backup "$SVC/src/index.ts"
cat > "$SVC/src/index.ts" << 'TS'
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { prisma } from '@a-health/database';
import { env } from './config/env.js';
import { requestContext } from './middlewares/context.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { authRouter, userRouter } from './routes/auth.routes.js';

const app = express();

app.set('trust proxy', true);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestContext);
app.use(
  morgan(':method :url :status :response-time ms', {
    // Auth bodies carry codes and passwords. Log the line, never the payload.
    skip: () => env.NODE_ENV === 'test',
  }),
);

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', dependencies: { database: 'ok' } });
  } catch {
    res.status(503).json({ status: 'degraded', dependencies: { database: 'down' } });
  }
});

// Mounted bare here. The gateway prefixes /api/v1 in front of every service, so
// each service stays unaware of the public path it is served under.
app.use(authRouter);
app.use(userRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`auth service listening on http://localhost:${env.PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
}
TS

echo "  business logic written"
echo
echo "Next:"
echo "  pnpm --filter @a-health/auth add @a-health/database@workspace:* @a-health/config@workspace:*"
echo "  pnpm --filter @a-health/auth exec tsc --noEmit"
echo "  pnpm --filter @a-health/auth dev"
