import { prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

/**
 * Coverage is incomplete when a patient can find care but cannot afford it.
 * This answers what is covered, by whom, and until when — before travelling,
 * not at the counter.
 *
 * `accepted_at_facility` is always null here: there is no facility-scheme
 * acceptance mapping in the schema yet. Returning null is honest; guessing
 * would not be.
 */
export async function getCoverage(caller: Caller, patientProfileId: string | undefined) {
  const targetId = patientProfileId ?? caller.ppid;
  if (!targetId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');

  const patient = await prisma.patientProfile.findUnique({ where: { id: targetId } });
  if (!patient) throw notFound('Patient profile not found');
  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot check coverage for this patient');
  }

  const memberships = await prisma.insuranceMembership.findMany({
    where: { patientProfileId: targetId },
    include: { scheme: { select: { id: true, name: true } } },
  });

  return {
    patient_profile_id: targetId,
    schemes: memberships.map((m) => ({
      scheme_id: m.scheme.id,
      scheme_name: m.scheme.name,
      membership_number: m.membershipNumber,
      status: m.status,
      accepted_at_facility: null,
      covered_services: m.coveredServices ?? [],
      valid_until: m.validUntil?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

function serialiseClaim(c: {
  id: string; consultationId: string; schemeId: string; status: string;
  itemCodes: unknown; amountClaimed: unknown; amountPaid: unknown; currency: string | null;
  rejectionReason: string | null; submittedAt: Date; decidedAt: Date | null; version: number;
}) {
  return {
    id: c.id,
    consultation_id: c.consultationId,
    scheme_id: c.schemeId,
    status: c.status,
    item_codes: c.itemCodes ?? [],
    rejection_reason: c.rejectionReason,
    submitted_at: c.submittedAt.toISOString(),
    decided_at: c.decidedAt?.toISOString() ?? null,
    version: c.version,
  };
}

/**
 * Submitted by the consultation's own clinician, or an admin — billing is
 * initiated by the provider who delivered the care, not by the patient.
 * Requires an active membership in the named scheme; a claim against a
 * scheme the patient does not belong to is rejected before it is ever
 * created, not after.
 */
export async function submitClaim(
  caller: Caller, input: { consultation_id: string; scheme_id: string; item_codes?: string[] }, meta: Meta,
) {
  const consultation = await prisma.consultationRequest.findUnique({ where: { id: input.consultation_id } });
  if (!consultation) throw notFound('Consultation not found');
  if (caller.role !== 'platform_admin' && consultation.assignedClinicianId !== caller.cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You did not deliver this consultation');
  }

  const scheme = await prisma.insuranceScheme.findUnique({ where: { id: input.scheme_id } });
  if (!scheme) throw notFound('Insurance scheme not found');

  const membership = await prisma.insuranceMembership.findFirst({
    where: { schemeId: input.scheme_id, patientProfileId: consultation.patientProfileId, status: 'active' },
  });
  if (!membership) {
    throw conflict('STATE_TRANSITION_INVALID', 'This patient has no active membership in that scheme');
  }

  const claim = await prisma.insuranceClaim.create({
    data: {
      consultationId: input.consultation_id,
      schemeId: input.scheme_id,
      itemCodes: (input.item_codes ?? []) as never,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'insurance.claim_submitted',
    entityType: 'insurance_claims', entityId: claim.id,
    metadata: { consultationId: input.consultation_id, schemeId: input.scheme_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseClaim(claim);
}

export async function listClaims(
  caller: Caller, query: { status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { consultation: { assignedClinicianId: caller.cpid } }
        : { consultation: { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } } };

  const rows = await prisma.insuranceClaim.findMany({
    where: { ...scope, ...(query.status ? { status: query.status as never } : {}) },
    orderBy: { submittedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseClaim);
}
