import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, recordChange } from '@a-health/http';
import { env } from '../config/env.js';
import type { CreateDependentInput, UpdateProfileInput } from '../types/patient.types.js';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

export function serialiseProfile(p: {
  id: string; userId: string | null; guardianUserId: string | null;
  fullName: string; dateOfBirth: Date | null; sex: string | null;
  chronicConditions: unknown; allergies: unknown; emergencyContact: string | null;
  bloodType: string | null;
  defaultLat: number | null; defaultLng: number | null; regionCode: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: p.id,
    user_id: p.userId,
    guardian_user_id: p.guardianUserId,
    full_name: p.fullName,
    date_of_birth: p.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    sex: p.sex,
    chronic_conditions: p.chronicConditions ?? [],
    allergies: p.allergies ?? [],
    emergency_contact: p.emergencyContact,
    blood_type: p.bloodType,
    default_location: p.defaultLat != null && p.defaultLng != null
      ? { lat: p.defaultLat, lng: p.defaultLng }
      : null,
    region_code: p.regionCode,
    version: p.version,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

/** A patient reads and writes their own profile, or their guardian does. Nobody else. */
async function assertOwner(profileId: string, caller: Caller) {
  const profile = await prisma.patientProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound('Patient profile not found');
  const owns = profile.userId === caller.sub || profile.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This profile does not belong to you');
  }
  return profile;
}

export async function getProfile(profileId: string, caller: Caller) {
  const profile = await assertOwner(profileId, caller);
  return serialiseProfile(profile);
}

/**
 * Optimistic concurrency on every write. Two devices editing the same profile
 * offline — a common shape here — must not have one silently overwrite the
 * other; a stale base_version is rejected rather than merged blindly.
 */
export async function updateProfile(profileId: string, caller: Caller, input: UpdateProfileInput) {
  const current = await assertOwner(profileId, caller);
  if (current.version !== input.base_version) {
    throw conflict('VERSION_CONFLICT', 'This profile was changed elsewhere. Reload and retry.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.patientProfile.update({
      where: { id: profileId },
      data: {
        ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
        ...(input.date_of_birth !== undefined ? { dateOfBirth: new Date(input.date_of_birth) } : {}),
        ...(input.sex !== undefined ? { sex: input.sex as never } : {}),
        ...(input.blood_type !== undefined ? { bloodType: input.blood_type } : {}),
        ...(input.chronic_conditions !== undefined ? { chronicConditions: input.chronic_conditions as never } : {}),
        ...(input.allergies !== undefined ? { allergies: input.allergies as never } : {}),
        ...(input.emergency_contact !== undefined ? { emergencyContact: input.emergency_contact } : {}),
        ...(input.default_location
          ? { defaultLat: input.default_location.lat, defaultLng: input.default_location.lng }
          : {}),
        ...(input.region_code !== undefined ? { regionCode: input.region_code } : {}),
        version: { increment: 1 },
      },
    });
    await recordChange(tx, {
      entity: 'patient_profiles', entityId: row.id, op: 'update',
      version: row.version, patientProfileId: row.id,
    });
    return row;
  });

  return serialiseProfile(updated);
}

/** Lists dependants under a guardian — the endpoint auth deliberately left for this service. */
export async function listDependents(guardianUserId: string, query: { cursor?: string; limit: number }) {
  const rows = await prisma.patientProfile.findMany({
    where: { guardianUserId },
    orderBy: { createdAt: 'asc' },
    take: query.limit,
  });
  return { data: rows.map(serialiseProfile) };
}

/**
 * A dependant profile has no login of its own. Every consultation raised for
 * one is attributed to the guardian's authenticated session plus the
 * dependant's patient_profile_id — never to a session the dependant holds,
 * because none exists.
 */
export async function createDependent(
  guardianUserId: string, input: CreateDependentInput, meta: Meta,
) {
  const count = await prisma.patientProfile.count({ where: { guardianUserId } });
  if (count >= env.MAX_DEPENDENTS_PER_GUARDIAN) {
    throw conflict('DUPLICATE_RESOURCE', 'Too many dependants on this account. Contact support to add more.');
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.patientProfile.create({
      data: {
        guardianUserId,
        fullName: input.full_name,
        dateOfBirth: new Date(input.date_of_birth),
        sex: input.sex as never,
        chronicConditions: (input.chronic_conditions ?? []) as never,
        allergies: (input.allergies ?? []) as never,
      },
    });
    await recordChange(tx, {
      entity: 'patient_profiles', entityId: row.id, op: 'create',
      version: row.version, patientProfileId: row.id,
    });
    return row;
  });

  await appendAudit({
    actorUserId: guardianUserId, action: 'dependent.created',
    entityType: 'patient_profiles', entityId: created.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseProfile(created);
}
