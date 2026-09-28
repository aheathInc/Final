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
import { AppError, conflict, forbidden, unauthenticated } from '../utils/errors.js';
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

function serialiseSessionUser(user: {
  id: string;
  fullName: string | null;
  phoneNumber: string;
  role: string;
  status: string;
  email: string | null;
  patientProfile?: { id: string; fullName: string } | null;
  clinicianProfile?: { id: string; specialty: string; verificationStatus: string } | null;
}) {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    full_name: user.fullName ?? user.patientProfile?.fullName ?? 'Patient',
    phone_number: user.phoneNumber,
    email: user.email,
    ...(user.patientProfile ? { patient_profile: { id: user.patientProfile.id, full_name: user.patientProfile.fullName } } : {}),
    ...(user.clinicianProfile ? { clinician_profile: { id: user.clinicianProfile.id, specialty: user.clinicianProfile.specialty, verification_status: user.clinicianProfile.verificationStatus } } : {}),
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

  const isDevBypass = env.NODE_ENV === 'development' && code === '000000';
  const matches = isDevBypass || (await bcrypt.compare(code, challenge.codeHash));
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

  let user = await prisma.user.findUnique({
    where: { phoneNumber: challenge.phoneNumber },
    include: { patientProfile: true, clinicianProfile: true },
  });

  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phoneNumber: challenge.phoneNumber,
          role: 'patient',
          status: 'active',
          fullName: null,
          preferredLanguage: 'en',
        },
        include: { patientProfile: true, clinicianProfile: true },
      });
      await tx.patientProfile.create({
        data: {
          userId: created.id,
          fullName: 'Patient',
        },
      });
      return await tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: { patientProfile: true, clinicianProfile: true },
      });
    });
  }

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

  const session = await issueSession(user, deviceId);
  return {
    ...session,
    user: serialiseSessionUser(user),
  };
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

  // Checked before the hash comparison. A locked account must not become a
  // free oracle for testing whether a password happens to be right.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'ACCOUNT_LOCKED',
      423,
      'Too many failed attempts. Try again later.',
    );
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    const failed = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (failed.failedLoginCount >= env.LOGIN_MAX_ATTEMPTS) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000),
          failedLoginCount: 0,
        },
      });
      await appendAudit({
        actorUserId: user.id,
        action: 'auth.account_locked',
        entityType: 'users',
        entityId: user.id,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      });
    }
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

  // Any success clears the counter, so an unlucky run of typos never
  // accumulates toward a lockout weeks later.
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  await appendAudit({
    actorUserId: user.id,
    action: 'auth.login',
    entityType: 'users',
    entityId: user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return issueSession(user, input.device_id, undefined, 'password');
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
  familyId: string = randomUUID(),
  amr: 'otp' | 'password' = 'otp',
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
    amr,
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


// ---------------------------------------------------------------------------
// Password lifecycle
// ---------------------------------------------------------------------------

/**
 * Sets, changes, or resets a password — one endpoint, one rule.
 *
 * You may set a password if you can prove either the current one, or control
 * of the registered phone number. The second case is what makes reset work
 * without a separate emailed-link flow: sign in by OTP, then set a new
 * password on that session. The token's `amr` claim is what distinguishes
 * the two, which is why it is minted at session creation and not asserted by
 * the caller.
 *
 * Setting a password revokes every other session. If the reason for changing
 * it was a suspected compromise, leaving the attacker's session alive would
 * defeat the whole exercise.
 */
export async function setPassword(
  userId: string,
  amr: 'otp' | 'password' | undefined,
  newPassword: string,
  currentPassword: string | undefined,
  meta: RequestMeta,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.role === 'patient') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Patient accounts sign in with a code, not a password');
  }

  if (user.passwordHash && amr !== 'otp') {
    if (!currentPassword) {
      throw new AppError(
        'CURRENT_PASSWORD_REQUIRED',
        422,
        'Provide your current password, or sign in with a code first',
        'current_password',
      );
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError(
        'CURRENT_PASSWORD_INCORRECT',
        401,
        'Current password is incorrect',
        'current_password',
      );
    }
  }

  // Rejected here rather than only in the client, because the client is not a
  // control. Length does more work than composition rules.
  if (newPassword.length < env.PASSWORD_MIN_LENGTH) {
    throw new AppError(
      'PASSWORD_TOO_WEAK',
      422,
      `Password must be at least ${env.PASSWORD_MIN_LENGTH} characters`,
      'new_password',
    );
  }
  const lowered = newPassword.toLowerCase();
  if (
    (user.email && lowered.includes(user.email.split('@')[0]!.toLowerCase())) ||
    lowered.includes(user.phoneNumber.slice(-6))
  ) {
    throw new AppError(
      'PASSWORD_TOO_WEAK',
      422,
      'Password must not contain your email or phone number',
      'new_password',
    );
  }
  if (user.passwordHash && (await bcrypt.compare(newPassword, user.passwordHash))) {
    throw new AppError('PASSWORD_TOO_WEAK', 422, 'New password must differ from the old one', 'new_password');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
        failedLoginCount: 0,
        lockedUntil: null,
        version: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await appendAudit({
    actorUserId: userId,
    action: user.passwordHash ? 'auth.password_changed' : 'auth.password_set',
    entityType: 'users',
    entityId: userId,
    metadata: { via: amr ?? 'password' },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}
