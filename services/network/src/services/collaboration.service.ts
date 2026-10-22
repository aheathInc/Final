import { prisma, type Prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable,
} from '@a-health/http';
import type { Caller, Meta } from './discussion.service.js';
import type { RequestCollaborationInput } from '../types/collaboration.types.js';

const DEFAULT_EXPIRY_HOURS = 24 * 7;
const MAX_EXPIRY_DAYS = 30;
const collaborationInclude = {
  requesterClinician: {
    include: {
      user: { select: { fullName: true } },
      facility: { select: { id: true, name: true } },
      department: { select: { id: true, name: true, facilityId: true } },
    },
  },
  invitedClinician: {
    include: {
      user: { select: { fullName: true } },
      facility: { select: { id: true, name: true } },
      department: { select: { id: true, name: true, facilityId: true } },
    },
  },
} satisfies Prisma.ProviderClinicalCollaborationInclude;
type CollaborationRow = Prisma.ProviderClinicalCollaborationGetPayload<{ include: typeof collaborationInclude }>;
type ActiveCollaborationRow = Prisma.ProviderClinicalCollaborationGetPayload<{
  include: {
    patientConsent: true;
    consultation: { select: { patientProfileId: true; careThreadId: true } };
  };
}>;

async function lockForActiveAccess(tx: Prisma.TransactionClient, id: string, patientConsentId: string | null) {
  // Consent is locked first to match the patient-revoke transaction's lock
  // order. A read/write linearizes either before revocation or after it.
  if (patientConsentId) {
    await tx.$queryRaw`SELECT "id" FROM "patient_consents" WHERE "id" = ${patientConsentId}::uuid FOR SHARE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "provider_clinical_collaborations" WHERE "id" = ${id}::uuid FOR SHARE`;
}

type ClinicianIdentity = {
  id: string;
  userId: string;
  specialty: string;
  facilityId: string | null;
  departmentId: string | null;
  verificationStatus: string;
  user: { fullName: string | null; status: string };
  facility: { id: string; name: string; isActive: boolean } | null;
  department: { id: string; name: string; facilityId: string; isActive: boolean } | null;
};

function assertClinicianClaim(caller: Caller): string {
  if (caller.role !== 'clinician' || !caller.cpid) {
    throw forbidden('ROLE_NOT_PERMITTED', 'A clinician account is required');
  }
  return caller.cpid;
}

async function currentClinician(caller: Caller): Promise<ClinicianIdentity> {
  const cpid = assertClinicianClaim(caller);
  const clinician = await prisma.clinicianProfile.findFirst({
    where: { id: cpid, userId: caller.sub },
    include: {
      user: { select: { fullName: true, status: true } },
      facility: { select: { id: true, name: true, isActive: true } },
      department: { select: { id: true, name: true, facilityId: true, isActive: true } },
    },
  });
  if (!clinician || clinician.verificationStatus !== 'verified' || clinician.user.status !== 'active') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'An active, verified clinician account is required');
  }
  if (!clinician.facilityId || !clinician.facility?.isActive) {
    throw forbidden('FACILITY_MEMBERSHIP_REQUIRED', 'An active facility assignment is required');
  }
  if (clinician.departmentId && (
    !clinician.department?.isActive || clinician.department.facilityId !== clinician.facilityId
  )) {
    throw forbidden('CLINICIAN_ASSIGNMENT_INVALID', 'The clinician department assignment is not active');
  }
  return clinician;
}

function clinicianSummary(c: CollaborationRow['requesterClinician'] | CollaborationRow['invitedClinician']) {
  return {
    clinician_id: c.id,
    full_name: c.user.fullName,
    specialty: c.specialty,
    facility_id: c.facilityId,
    facility_name: c.facility?.name ?? null,
    department_id: c.departmentId,
    department_name: c.department?.name ?? null,
  };
}

function serialise(row: CollaborationRow, callerCpid: string) {
  return {
    id: row.id,
    consultation_id: row.consultationId,
    care_thread_id: row.careThreadId,
    requester: clinicianSummary(row.requesterClinician),
    invited: clinicianSummary(row.invitedClinician),
    requester_assignment_at_request: {
      facility_id: row.requesterFacilityId,
      department_id: row.requesterDepartmentId,
    },
    invited_assignment_at_request: {
      facility_id: row.invitedFacilityId,
      department_id: row.invitedDepartmentId,
    },
    viewer_role: row.requesterClinicianId === callerCpid ? 'requester' as const : 'invitee' as const,
    scope: row.scope,
    status: row.status,
    question: row.question,
    requested_at: row.requestedAt.toISOString(),
    responded_at: row.respondedAt?.toISOString() ?? null,
    expires_at: row.expiresAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
    version: row.version,
  };
}

async function ownedConsultation(consultationId: string, cpid: string) {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    include: {
      careThread: { select: { id: true, primaryClinicianId: true } },
    },
  });
  if (!consultation) throw notFound('Consultation not found');
  if (consultation.assignedClinicianId !== cpid && consultation.careThread.primaryClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not involved in this consultation');
  }
  return consultation;
}

async function activeConsent(consultation: { patientProfileId: string; careThreadId: string }, invitedClinicianId: string, now: Date) {
  return prisma.patientConsent.findFirst({
    where: {
      patientProfileId: consultation.patientProfileId,
      careThreadId: consultation.careThreadId,
      granteeType: 'clinician',
      granteeClinicianId: invitedClinicianId,
      scope: 'current_thread',
      allowed: true,
      breakGlass: false,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { grantedAt: 'desc' },
  });
}

function consentIsActive(
  consent: { id: string; patientProfileId: string; careThreadId: string | null; granteeType: string;
    granteeClinicianId: string | null; scope: string; allowed: boolean; breakGlass: boolean;
    revokedAt: Date | null; expiresAt: Date | null } | null,
  row: { patientConsentId: string | null; careThreadId: string; invitedClinicianId: string;
    consultation: { patientProfileId: string; careThreadId: string } },
  now: Date,
) {
  return Boolean(consent && row.patientConsentId === consent.id &&
    consent.patientProfileId === row.consultation.patientProfileId &&
    row.consultation.careThreadId === row.careThreadId &&
    consent.careThreadId === row.careThreadId &&
    consent.granteeType === 'clinician' && consent.granteeClinicianId === row.invitedClinicianId &&
    consent.scope === 'current_thread' && consent.allowed && !consent.breakGlass && !consent.revokedAt &&
    (!consent.expiresAt || consent.expiresAt > now));
}

async function expireOrRevokeIfNeeded(id: string, now = new Date()) {
  const row = await prisma.providerClinicalCollaboration.findUnique({
    where: { id },
    include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
  });
  if (!row || !['requested', 'accepted'].includes(row.status)) return;

  const consentExpired = Boolean(row.patientConsent?.expiresAt && row.patientConsent.expiresAt <= now);
  const collaborationExpired = row.expiresAt <= now;
  const consentRevoked = !consentIsActive(row.patientConsent, row, now) && !consentExpired;
  if (!collaborationExpired && !consentExpired && !consentRevoked) return;

  const nextStatus = consentRevoked ? 'revoked' : 'expired';
  const action = consentRevoked ? 'provider_collaboration.revoked' : 'provider_collaboration.expired';
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.providerClinicalCollaboration.updateMany({
      where: { id, status: row.status, version: row.version },
      data: {
        status: nextStatus,
        ...(nextStatus === 'revoked' ? { revokedAt: now } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) return false;
    await appendAudit({
      action,
      entityType: 'provider_clinical_collaborations',
      entityId: id,
      metadata: {
        scope: 'consultation_summary',
        reason: consentRevoked ? 'patient_consent_unavailable' : 'access_expired',
      },
    }, tx);
    return true;
  });
  return changed;
}

async function loadCollaboration(id: string, caller: Caller) {
  await expireOrRevokeIfNeeded(id);
  const row = await prisma.providerClinicalCollaboration.findUnique({
    where: { id },
    include: {
      ...collaborationInclude,
      patientConsent: true,
      consultation: { select: { id: true, patientProfileId: true, careThreadId: true } },
    },
  });
  if (!row) throw notFound('Clinical collaboration not found');
  const cpid = assertClinicianClaim(caller);
  if (row.requesterClinicianId !== cpid && row.invitedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not a participant in this collaboration');
  }
  await currentClinician(caller);
  return { row, cpid };
}

async function requireActiveCollaboration(id: string, caller: Caller) {
  const { row, cpid } = await loadCollaboration(id, caller);
  const now = new Date();
  if (row.status !== 'accepted' || row.expiresAt <= now) {
    throw forbidden('COLLABORATION_NOT_ACTIVE', 'Case access is not active');
  }
  if (!consentIsActive(row.patientConsent, row, now)) {
    await expireOrRevokeIfNeeded(id, now);
    throw forbidden('PATIENT_CONSENT_REQUIRED', 'The patient authorization for this clinician is no longer active');
  }
  return { row, cpid };
}

function assertActiveRow(
  row: ActiveCollaborationRow | null,
  cpid: string,
  now: Date,
) {
  if (!row || row.status !== 'accepted' || row.expiresAt <= now ||
      (row.requesterClinicianId !== cpid && row.invitedClinicianId !== cpid) ||
      !consentIsActive(row.patientConsent, row, now)) {
    throw forbidden('COLLABORATION_NOT_ACTIVE', 'Case discussion access is no longer active');
  }
}

export async function listCollaborativeCases(caller: Caller, query: { cursor?: string; limit: number }) {
  const clinician = await currentClinician(caller);
  const rows = await prisma.consultationRequest.findMany({
    where: {
      OR: [
        { assignedClinicianId: clinician.id },
        { careThread: { primaryClinicianId: clinician.id } },
      ],
    },
    select: {
      id: true, careThreadId: true, urgencyLevel: true, status: true,
      symptomText: true, createdAt: true, updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, (row) => ({
    consultation_id: row.id,
    care_thread_id: row.careThreadId,
    urgency_level: row.urgencyLevel,
    status: row.status,
    case_summary: row.symptomText,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }));
}

export async function listEligibleClinicians(consultationId: string, caller: Caller) {
  const requester = await currentClinician(caller);
  const consultation = await ownedConsultation(consultationId, requester.id);
  const now = new Date();
  const consents = await prisma.patientConsent.findMany({
    where: {
      patientProfileId: consultation.patientProfileId,
      careThreadId: consultation.careThreadId,
      granteeType: 'clinician',
      granteeClinicianId: { not: null },
      scope: 'current_thread',
      allowed: true,
      breakGlass: false,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { granteeClinicianId: true },
  });
  const ids = [...new Set(consents
    .map((consent) => consent.granteeClinicianId)
    .filter((id): id is string => Boolean(id) && id !== requester.id))];
  if (ids.length === 0) return { data: [] };

  const clinicians = await prisma.clinicianProfile.findMany({
    where: {
      id: { in: ids },
      verificationStatus: 'verified',
      user: { status: 'active' },
      facility: { isActive: true },
    },
    include: {
      user: { select: { fullName: true } },
      facility: { select: { id: true, name: true, isActive: true } },
      department: { select: { id: true, name: true, facilityId: true, isActive: true } },
    },
    orderBy: [{ specialty: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    data: clinicians
      .filter((c) => !c.departmentId || (c.department?.isActive && c.department.facilityId === c.facilityId))
      .map((c) => ({
        clinician_id: c.id,
        full_name: c.user.fullName,
        specialty: c.specialty,
        facility_id: c.facilityId,
        facility_name: c.facility?.name ?? null,
        department_id: c.departmentId,
        department_name: c.department?.name ?? null,
      })),
  };
}

export async function requestCollaboration(caller: Caller, input: RequestCollaborationInput, meta: Meta) {
  const requester = await currentClinician(caller);
  const consultation = await ownedConsultation(input.consultation_id, requester.id);
  if (input.invited_clinician_id === requester.id) {
    throw unprocessable('Choose another verified clinician', 'invited_clinician_id');
  }

  const invited = await prisma.clinicianProfile.findFirst({
    where: {
      id: input.invited_clinician_id,
      verificationStatus: 'verified',
      user: { status: 'active' },
      facility: { isActive: true },
    },
    include: { facility: true, department: true },
  });
  if (!invited || !invited.facilityId || !invited.facility) {
    throw forbidden('COLLABORATOR_NOT_ELIGIBLE', 'The selected clinician is not currently eligible');
  }
  if (invited.departmentId && (
    !invited.department?.isActive || invited.department.facilityId !== invited.facilityId
  )) {
    throw forbidden('COLLABORATOR_NOT_ELIGIBLE', 'The selected clinician assignment is not currently eligible');
  }

  const now = new Date();
  const requestedExpiry = input.expires_at
    ? new Date(input.expires_at)
    : new Date(now.getTime() + DEFAULT_EXPIRY_HOURS * 3_600_000);
  if (requestedExpiry <= now || requestedExpiry.getTime() > now.getTime() + MAX_EXPIRY_DAYS * 86_400_000) {
    throw unprocessable('Expiry must be in the future and no more than 30 days away', 'expires_at');
  }
  const consent = await activeConsent(consultation, invited.id, now);
  if (!consent) {
    throw forbidden('PATIENT_CONSENT_REQUIRED', 'The patient must authorize this clinician for this care thread first');
  }

  const row = await prisma.$transaction(async (tx) => {
    // Serialize request creation with patient revocation. Re-read the exact
    // consent only after acquiring its share lock; the earlier lookup is for
    // eligibility and may have raced with a revoke.
    await tx.$queryRaw`SELECT "id" FROM "patient_consents" WHERE "id" = ${consent.id}::uuid FOR SHARE`;
    const currentConsent = await tx.patientConsent.findUnique({ where: { id: consent.id } });
    const checkedAt = new Date();
    if (!currentConsent ||
        currentConsent.patientProfileId !== consultation.patientProfileId ||
        currentConsent.careThreadId !== consultation.careThreadId ||
        currentConsent.granteeType !== 'clinician' ||
        currentConsent.granteeClinicianId !== invited.id ||
        currentConsent.scope !== 'current_thread' ||
        !currentConsent.allowed || currentConsent.breakGlass || currentConsent.revokedAt ||
        (currentConsent.expiresAt && currentConsent.expiresAt <= checkedAt)) {
      throw forbidden('PATIENT_CONSENT_REQUIRED', 'The patient authorization is no longer active');
    }
    const expiresAt = currentConsent.expiresAt && currentConsent.expiresAt < requestedExpiry
      ? currentConsent.expiresAt
      : requestedExpiry;
    const lockKey = `${consultation.id}:${requester.id}:${invited.id}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked`;
    const duplicate = await tx.providerClinicalCollaboration.findFirst({
      where: {
        consultationId: consultation.id,
        requesterClinicianId: requester.id,
        invitedClinicianId: invited.id,
        status: { in: ['requested', 'accepted'] },
        expiresAt: { gt: now },
      },
    });
    if (duplicate) throw conflict('COLLABORATION_ALREADY_EXISTS', 'A collaboration request is already active');

    const collaboration = await tx.providerClinicalCollaboration.create({
      data: {
        consultationId: consultation.id,
        careThreadId: consultation.careThreadId,
        requesterClinicianId: requester.id,
        invitedClinicianId: invited.id,
        requesterFacilityId: requester.facilityId,
        requesterDepartmentId: requester.departmentId,
        invitedFacilityId: invited.facilityId,
        invitedDepartmentId: invited.departmentId,
        patientConsentId: currentConsent.id,
        scope: 'consultation_summary',
        question: input.question,
        expiresAt,
      },
    });
    await appendAudit({
      actorUserId: caller.sub,
      action: 'provider_collaboration.requested',
      entityType: 'provider_clinical_collaborations',
      entityId: collaboration.id,
      metadata: { scope: 'consultation_summary' },
      ipAddress: meta.ip,
      requestId: meta.requestId,
    }, tx);
    return collaboration;
  });
  return serialise(await prisma.providerClinicalCollaboration.findUniqueOrThrow({
    where: { id: row.id }, include: collaborationInclude,
  }), requester.id);
}

async function expireForClinician(cpid: string) {
  const rows = await prisma.providerClinicalCollaboration.findMany({
    where: { OR: [{ requesterClinicianId: cpid }, { invitedClinicianId: cpid }], status: { in: ['requested', 'accepted'] } },
    select: { id: true },
  });
  for (const row of rows) await expireOrRevokeIfNeeded(row.id);
}

export async function listCollaborations(caller: Caller, query: { cursor?: string; limit: number }) {
  const clinician = await currentClinician(caller);
  await expireForClinician(clinician.id);
  const rows = await prisma.providerClinicalCollaboration.findMany({
    where: { OR: [{ requesterClinicianId: clinician.id }, { invitedClinicianId: clinician.id }] },
    include: collaborationInclude,
    orderBy: { requestedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, (row) => serialise(row, clinician.id));
}

export async function getCollaboration(id: string, caller: Caller) {
  const { row, cpid } = await loadCollaboration(id, caller);
  return serialise(row, cpid);
}

export async function acceptCollaboration(id: string, caller: Caller, meta: Meta) {
  const cpid = assertClinicianClaim(caller);
  await expireOrRevokeIfNeeded(id);
  const row = await prisma.providerClinicalCollaboration.findUnique({
    where: { id },
    include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
  });
  if (!row) throw notFound('Clinical collaboration not found');
  if (row.invitedClinicianId !== cpid) throw forbidden('NOT_RESOURCE_OWNER', 'Only the invited clinician may accept');
  await currentClinician(caller);
  if (row.status !== 'requested') throw conflict('STATE_TRANSITION_INVALID', 'This request is no longer awaiting a response');
  const now = new Date();
  if (row.expiresAt <= now) {
    await expireOrRevokeIfNeeded(id, now);
    throw conflict('COLLABORATION_EXPIRED', 'This collaboration request has expired');
  }
  if (!consentIsActive(row.patientConsent, row, now)) {
    await expireOrRevokeIfNeeded(id, now);
    throw forbidden('PATIENT_CONSENT_REQUIRED', 'The patient authorization is no longer active');
  }

  const accepted = await prisma.$transaction(async (tx) => {
    await lockForActiveAccess(tx, id, row.patientConsentId);
    const current = await tx.providerClinicalCollaboration.findUnique({
      where: { id },
      include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
    });
    const checkedAt = new Date();
    if (!current || current.status !== 'requested' || current.expiresAt <= checkedAt) {
      throw conflict('STATE_TRANSITION_INVALID', 'This request is no longer awaiting a response');
    }
    if (!consentIsActive(current.patientConsent, current, checkedAt)) {
      throw forbidden('PATIENT_CONSENT_REQUIRED', 'The patient authorization is no longer active');
    }
    const update = await tx.providerClinicalCollaboration.updateMany({
      where: { id, status: 'requested', version: current.version, expiresAt: { gt: checkedAt }, patientConsentId: current.patientConsentId },
      data: { status: 'accepted', respondedAt: checkedAt, version: { increment: 1 } },
    });
    if (update.count !== 1) throw conflict('STATE_TRANSITION_INVALID', 'This request changed while being accepted');
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.accepted',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary' }, ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.case_access_granted',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary' }, ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return tx.providerClinicalCollaboration.findUniqueOrThrow({ where: { id }, include: collaborationInclude });
  });
  return serialise(accepted, cpid);
}

export async function declineCollaboration(id: string, caller: Caller, meta: Meta) {
  const cpid = assertClinicianClaim(caller);
  await expireOrRevokeIfNeeded(id);
  const row = await prisma.providerClinicalCollaboration.findUnique({ where: { id } });
  if (!row) throw notFound('Clinical collaboration not found');
  if (row.invitedClinicianId !== cpid) throw forbidden('NOT_RESOURCE_OWNER', 'Only the invited clinician may decline');
  await currentClinician(caller);
  const now = new Date();
  const declined = await prisma.$transaction(async (tx) => {
    const update = await tx.providerClinicalCollaboration.updateMany({
      where: { id, status: 'requested', expiresAt: { gt: now } },
      data: { status: 'declined', respondedAt: now, version: { increment: 1 } },
    });
    if (update.count !== 1) throw conflict('STATE_TRANSITION_INVALID', 'This request is no longer awaiting a response');
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.declined',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary' }, ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return tx.providerClinicalCollaboration.findUniqueOrThrow({ where: { id }, include: collaborationInclude });
  });
  return serialise(declined, cpid);
}

export async function revokeCollaboration(id: string, caller: Caller, meta: Meta) {
  const cpid = assertClinicianClaim(caller);
  await expireOrRevokeIfNeeded(id);
  const row = await prisma.providerClinicalCollaboration.findUnique({ where: { id } });
  if (!row) throw notFound('Clinical collaboration not found');
  if (row.requesterClinicianId !== cpid && row.invitedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'Only a collaboration participant may revoke access');
  }
  await currentClinician(caller);
  const now = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    const update = await tx.providerClinicalCollaboration.updateMany({
      where: { id, status: { in: ['requested', 'accepted'] } },
      data: { status: 'revoked', revokedAt: now, revokedByUserId: caller.sub, version: { increment: 1 } },
    });
    if (update.count !== 1) throw conflict('STATE_TRANSITION_INVALID', 'This collaboration is already inactive');
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.revoked',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary', reason: 'participant_revoked' },
      ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return tx.providerClinicalCollaboration.findUniqueOrThrow({ where: { id }, include: collaborationInclude });
  });
  return serialise(revoked, cpid);
}

export async function getSharedCase(id: string, caller: Caller, meta: Meta) {
  const { row, cpid } = await requireActiveCollaboration(id, caller);
  return prisma.$transaction(async (tx) => {
    await lockForActiveAccess(tx, id, row.patientConsentId);
    const current = await tx.providerClinicalCollaboration.findUnique({
      where: { id }, include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
    });
    assertActiveRow(current, cpid, new Date());
    const consultation = await tx.consultationRequest.findUnique({
      where: { id: current!.consultationId },
      select: {
        id: true, careThreadId: true, urgencyLevel: true, status: true,
        symptomText: true, structuredSymptoms: true, createdAt: true,
      },
    });
    if (!consultation) throw notFound('Consultation not found');
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.case_accessed',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary' }, ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return {
      collaboration_id: id,
      scope: 'consultation_summary',
      case: {
        consultation_id: consultation.id,
        care_thread_id: consultation.careThreadId,
        urgency_level: consultation.urgencyLevel,
        status: consultation.status,
        case_summary: consultation.symptomText,
        structured_symptoms: consultation.structuredSymptoms ?? [],
        created_at: consultation.createdAt.toISOString(),
      },
      viewer_role: current!.requesterClinicianId === cpid ? 'requester' as const : 'invitee' as const,
    };
  });
}

export async function listCollaborationMessages(
  id: string, caller: Caller, query: { cursor?: string; limit: number }, meta: Meta,
) {
  const { row, cpid } = await requireActiveCollaboration(id, caller);
  return prisma.$transaction(async (tx) => {
    await lockForActiveAccess(tx, id, row.patientConsentId);
    const current = await tx.providerClinicalCollaboration.findUnique({
      where: { id }, include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
    });
    assertActiveRow(current, cpid, new Date());
    const rows = await tx.providerClinicalCollaborationMessage.findMany({
      where: { collaborationId: id },
      orderBy: { createdAt: 'asc' },
      ...cursorArgs(query.cursor, query.limit),
    });
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.discussion_accessed',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary' }, ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return toCursorPage(rows, query.limit, (message) => ({
      id: message.id,
      collaboration_id: message.collaborationId,
      author_clinician_id: message.authorClinicianId,
      body: message.body,
      created_at: message.createdAt.toISOString(),
    }));
  });
}

export async function createCollaborationMessage(id: string, caller: Caller, body: string, meta: Meta) {
  const { row, cpid } = await requireActiveCollaboration(id, caller);
  const message = await prisma.$transaction(async (tx) => {
    await lockForActiveAccess(tx, id, row.patientConsentId);
    const current = await tx.providerClinicalCollaboration.findUnique({
      where: { id }, include: { patientConsent: true, consultation: { select: { patientProfileId: true, careThreadId: true } } },
    });
    const now = new Date();
    assertActiveRow(current, cpid, now);
    const created = await tx.providerClinicalCollaborationMessage.create({
      data: { collaborationId: id, authorClinicianId: cpid, body },
    });
    await appendAudit({
      actorUserId: caller.sub, action: 'provider_collaboration.message_recorded',
      entityType: 'provider_clinical_collaborations', entityId: id,
      metadata: { scope: 'consultation_summary', messageId: created.id },
      ipAddress: meta.ip, requestId: meta.requestId,
    }, tx);
    return created;
  });
  return {
    id: message.id,
    collaboration_id: message.collaborationId,
    author_clinician_id: message.authorClinicianId,
    body: message.body,
    created_at: message.createdAt.toISOString(),
  };
}
