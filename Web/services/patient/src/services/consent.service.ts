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
    where: { patientProfileId: profileId, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  });
  return { data: rows.map(serialise) };
}

export async function grantConsent(
  profileId: string, caller: Caller, input: GrantConsentInput, meta: Meta,
) {
  await assertOwner(profileId, caller);

  const consent = await prisma.patientConsent.create({
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
  });

  return serialise(consent);
}

/**
 * Revoke, never delete. The record that access was granted and later
 * withdrawn is itself part of the accountability trail the platform promises.
 */
export async function revokeConsent(profileId: string, consentId: string, caller: Caller, meta: Meta) {
  await assertOwner(profileId, caller);

  const consent = await prisma.patientConsent.findUnique({ where: { id: consentId } });
  if (!consent || consent.patientProfileId !== profileId) throw notFound('Consent not found');

  const updated = await prisma.patientConsent.update({
    where: { id: consentId },
    data: { allowed: false, revokedAt: new Date(), version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consent.revoked',
    entityType: 'patient_consents', entityId: consentId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(updated);
}
