import { prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound } from '@a-health/http';
import type { GrantConsentInput } from '../types/patient.types.js';
import type { Caller, Meta } from './profile.service.js';

function serialise(c: {
  id: string; patientProfileId: string; granteeType: string;
  granteeClinicianId: string | null; granteeFacilityId: string | null;
  careThreadId: string | null; scope: string; allowed: boolean;
  breakGlass: boolean; reason: string | null;
  grantedAt: Date; expiresAt: Date | null; revokedAt: Date | null;
  version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    patient_profile_id: c.patientProfileId,
    grantee_type: c.granteeType,
    grantee_clinician_id: c.granteeClinicianId,
    grantee_facility_id: c.granteeFacilityId,
    care_thread_id: c.careThreadId,
    scope: c.scope,
    allowed: c.allowed,
    break_glass: c.breakGlass,
    reason: c.reason,
    granted_at: c.grantedAt.toISOString(),
    expires_at: c.expiresAt?.toISOString() ?? null,
    revoked_at: c.revokedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function assertOwner(profileId: string, caller: Caller) {
  const profile = await prisma.patientProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound('Patient profile not found');
  const owns = profile.userId === caller.sub || profile.guardianUserId === caller.sub;
  if (!owns && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'This profile does not belong to you');
  }
  return profile;
}

/**
 * Who may see what. The blueprint's promise is that a patient controls this,
 * so every grant and revoke is both explicit and audited — this list is what
 * a "who has seen my records" screen reads from.
 */
export async function listConsents(profileId: string, caller: Caller) {
  await assertOwner(profileId, caller);
  const rows = await prisma.patientConsent.findMany({
    // Keep revoked grants in the patient's view: the history is needed to
    // confirm that access was withdrawn after a refresh.
    where: { patientProfileId: profileId },
    orderBy: { grantedAt: 'desc' },
  });
  return { data: rows.map(serialise) };
}

export async function grantConsent(
  profileId: string, caller: Caller, input: GrantConsentInput, meta: Meta,
) {
  await assertOwner(profileId, caller);

  return prisma.$transaction(async (tx) => {
    const consent = await tx.patientConsent.create({
      data: {
        patientProfileId: profileId,
        granteeType: input.grantee_type as never,
        granteeClinicianId: input.grantee_clinician_id ?? null,
        granteeFacilityId: input.grantee_facility_id ?? null,
        careThreadId: input.care_thread_id ?? null,
        scope: input.scope as never,
        reason: input.reason ?? null,
        expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      },
    });

    await appendAudit({
      actorUserId: caller.sub, action: 'consent.granted',
      entityType: 'patient_consents', entityId: consent.id,
      metadata: { scope: input.scope, granteeType: input.grantee_type },
      ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);

    return serialise(consent);
  });
}

/**
 * Revoke, never delete. The record that access was granted and later
 * withdrawn is itself part of the accountability trail the platform promises.
 */
export async function revokeConsent(profileId: string, consentId: string, caller: Caller, meta: Meta) {
  await assertOwner(profileId, caller);

  return prisma.$transaction(async (tx) => {
    const consent = await tx.patientConsent.findUnique({ where: { id: consentId } });
    if (!consent || consent.patientProfileId !== profileId) throw notFound('Consent not found');

    const updated = await tx.patientConsent.update({
      where: { id: consentId },
      data: { allowed: false, revokedAt: new Date(), version: { increment: 1 } },
    });

    await appendAudit({
      actorUserId: caller.sub, action: 'consent.revoked',
      entityType: 'patient_consents', entityId: consentId,
      metadata: { scope: consent.scope, granteeType: consent.granteeType },
      ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);

    return serialise(updated);
  });
}

/** A patient or guardian may see only their own safe consent/access events. */
export async function listOwnAuditHistory(profileId: string, caller: Caller) {
  if (caller.role !== 'patient') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Patient audit history is available to patient accounts only');
  }
  await assertOwner(profileId, caller);

  const consents = await prisma.patientConsent.findMany({
    where: { patientProfileId: profileId },
    select: { id: true, scope: true, granteeType: true },
  });
  const consentById = new Map(consents.map((consent) => [consent.id, consent]));
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: ['consent.granted', 'consent.revoked', 'emergency.context_break_glass_access'] },
      OR: [
        { entityType: 'patient_profiles', entityId: profileId },
        { entityType: 'patient_consents', entityId: { in: consents.map((consent) => consent.id) } },
      ],
    },
    orderBy: { seq: 'desc' },
    take: 100,
    select: { action: true, entityId: true, metadata: true, createdAt: true },
  });

  return {
    data: rows.map((row) => {
      const linkedConsent = row.entityId ? consentById.get(row.entityId) : undefined;
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const scope = typeof metadata.scope === 'string' ? metadata.scope : linkedConsent?.scope;
      const granteeType = typeof metadata.granteeType === 'string'
        ? metadata.granteeType
        : linkedConsent?.granteeType;

      return {
        event_type: row.action,
        occurred_at: row.createdAt.toISOString(),
        ...(row.action.startsWith('consent.') && scope ? { scope } : {}),
        ...(row.action.startsWith('consent.') && granteeType ? { grantee_type: granteeType } : {}),
      };
    }),
  };
}
