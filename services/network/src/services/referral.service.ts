import { prisma, type Prisma } from '@a-health/database';
import { enqueue } from '@a-health/notification/enqueue';
import { appendAudit, conflict, cursorArgs, forbidden, notFound, toCursorPage, unprocessable } from '@a-health/http';
import type { CompleteReferralInput, CreateReferralInput } from '../types/referral.types.js';

export interface ReferralCaller { sub: string; role: string; cpid?: string; ppid?: string }
export interface ReferralMeta { ip?: string | null; requestId?: string | null }

const referralInclude = {
  patient: { select: { id: true, userId: true, guardianUserId: true } },
  consultation: { select: { id: true, careThreadId: true, patientProfileId: true } },
  sourceClinician: {
    include: {
      user: { select: { fullName: true, status: true } },
      facility: { select: { id: true, name: true, isActive: true } },
      department: { select: { id: true, name: true, isActive: true, facilityId: true } },
    },
  },
  destinationFacility: { select: { id: true, name: true, isActive: true } },
  destinationDepartment: { select: { id: true, name: true, isActive: true, facilityId: true } },
  destinationClinician: {
    include: {
      user: { select: { fullName: true, status: true } },
      facility: { select: { id: true, name: true, isActive: true } },
      department: { select: { id: true, name: true, isActive: true, facilityId: true } },
    },
  },
  receivedByClinician: {
    include: {
      user: { select: { fullName: true, status: true } },
      facility: { select: { id: true, name: true, isActive: true } },
      department: { select: { id: true, name: true, isActive: true, facilityId: true } },
    },
  },
  patientConsent: true,
  outcome: { include: { receivingClinician: { include: { user: { select: { fullName: true } } } } } },
} satisfies Prisma.DigitalReferralInclude;
type ReferralRow = Prisma.DigitalReferralGetPayload<{ include: typeof referralInclude }>;

const terminalStatuses = ['declined', 'completed', 'cancelled', 'expired'] as const;
const activeStatuses = ['draft', 'submitted', 'received', 'accepted', 'in_care'] as const;

async function currentClinician(caller: ReferralCaller) {
  if (caller.role !== 'clinician' || !caller.cpid) {
    throw forbidden('ROLE_NOT_PERMITTED', 'A clinician account is required');
  }
  const clinician = await prisma.clinicianProfile.findFirst({
    where: { id: caller.cpid, userId: caller.sub },
    include: {
      user: { select: { status: true } },
      facility: { select: { id: true, isActive: true } },
      department: { select: { id: true, facilityId: true, isActive: true } },
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

function destinationEligible(
  referral: Pick<ReferralRow, 'sourceClinicianId' | 'destinationFacilityId' | 'destinationDepartmentId' | 'destinationClinicianId'>,
  clinician: Awaited<ReturnType<typeof currentClinician>>,
) {
  return clinician.id !== referral.sourceClinicianId &&
    clinician.facilityId === referral.destinationFacilityId &&
    (!referral.destinationDepartmentId || clinician.departmentId === referral.destinationDepartmentId) &&
    (!referral.destinationClinicianId || clinician.id === referral.destinationClinicianId);
}

function consentActive(row: ReferralRow, now = new Date()) {
  const consent = row.patientConsent;
  return consent.patientProfileId === row.patientProfileId &&
    consent.careThreadId === row.consultation.careThreadId &&
    consent.granteeType === 'facility' &&
    consent.granteeFacilityId === row.destinationFacilityId &&
    consent.scope === 'current_thread' && consent.allowed && !consent.breakGlass && !consent.revokedAt &&
    (!consent.expiresAt || consent.expiresAt > now);
}

function serialise(row: ReferralRow, options: { includeClinical: boolean; includeOutcome: boolean }) {
  const clinician = (value: ReferralRow['sourceClinician'] | ReferralRow['destinationClinician'] | ReferralRow['receivedByClinician']) => value ? ({
    clinician_id: value.id,
    full_name: value.user.fullName,
    specialty: value.specialty,
  }) : null;
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    purpose: row.purpose,
    clinical_summary: options.includeClinical ? row.clinicalSummary : null,
    consultation_id: row.consultationId,
    source: {
      clinician: clinician(row.sourceClinician),
      facility: { id: row.sourceFacilityId, name: row.sourceClinician.facility?.name ?? 'Source facility' },
      department: row.sourceClinician.department ? { id: row.sourceClinician.department.id, name: row.sourceClinician.department.name } : null,
    },
    destination: {
      facility: { id: row.destinationFacilityId, name: row.destinationFacility.name },
      department: row.destinationDepartment ? { id: row.destinationDepartment.id, name: row.destinationDepartment.name } : null,
      clinician: clinician(row.destinationClinician),
    },
    received_by: clinician(row.receivedByClinician),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    submitted_at: row.submittedAt?.toISOString() ?? null,
    received_at: row.receivedAt?.toISOString() ?? null,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    declined_at: row.declinedAt?.toISOString() ?? null,
    decline_reason: row.declineReason,
    care_started_at: row.careStartedAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
    cancelled_at: row.cancelledAt?.toISOString() ?? null,
    outcome: options.includeOutcome && row.outcome ? {
      id: row.outcome.id,
      status: row.outcome.status,
      receiving_clinician: {
        clinician_id: row.outcome.receivingClinicianId,
        full_name: row.outcome.receivingClinician.user.fullName,
      },
      follow_up_recommendation: row.outcome.followUpRecommendation,
      patient_instructions: row.outcome.patientInstructions,
      recorded_at: row.outcome.recordedAt.toISOString(),
    } : null,
    version: row.version,
  };
}

async function audit(input: {
  caller?: ReferralCaller; action: string; id: string; meta?: ReferralMeta; metadata?: Record<string, unknown>;
}, tx?: Prisma.TransactionClient) {
  await appendAudit({
    actorUserId: input.caller?.sub ?? null,
    action: input.action,
    entityType: 'digital_referrals',
    entityId: input.id,
    ipAddress: input.meta?.ip,
    requestId: input.meta?.requestId,
    metadata: input.metadata ?? {},
  }, tx);
}

async function lockReferral(tx: Prisma.TransactionClient, id: string) {
  const reference = await tx.digitalReferral.findUnique({ where: { id }, select: { patientConsentId: true } });
  if (!reference) throw notFound('Referral not found');
  await tx.$queryRaw`SELECT "id" FROM "patient_consents" WHERE "id" = ${reference.patientConsentId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "digital_referrals" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return tx.digitalReferral.findUnique({ where: { id }, include: referralInclude });
}

async function expireOrCancelIfNeeded(id: string) {
  const current = await prisma.digitalReferral.findUnique({ where: { id }, include: referralInclude });
  if (!current || !(activeStatuses as readonly string[]).includes(current.status)) return current;
  const now = new Date();
  const consentExpired = Boolean(current.patientConsent.expiresAt && current.patientConsent.expiresAt <= now);
  const authorizationRevoked = !consentActive(current, now);
  const expired = current.expiresAt <= now && ['draft', 'submitted', 'received'].includes(current.status);
  if (!authorizationRevoked && !consentExpired && !expired) return current;

  const result = await prisma.$transaction(async (tx) => {
    const row = await lockReferral(tx, id);
    if (!row || !(activeStatuses as readonly string[]).includes(row.status)) return null;
    const checkedAt = new Date();
    const consentStillActive = consentActive(row, checkedAt);
    const shouldExpire = row.expiresAt <= checkedAt && ['draft', 'submitted', 'received'].includes(row.status);
    if (consentStillActive && !shouldExpire) return row;
    const consentWasRevoked = !consentStillActive;
    const nextStatus = consentWasRevoked ? 'cancelled' : 'expired';
    const changed = await tx.digitalReferral.updateMany({
      where: { id, status: row.status, version: row.version },
      data: {
        status: nextStatus,
        ...(nextStatus === 'cancelled' ? { cancelledAt: checkedAt, cancellationReason: 'consent_unavailable' } : {}),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;
    await audit({
      action: consentWasRevoked ? 'referral.cancelled' : 'referral.expired', id,
      metadata: { reason: consentWasRevoked ? 'authorization_unavailable' : 'referral_expired' },
    }, tx);
    return tx.digitalReferral.findUnique({ where: { id }, include: referralInclude });
  });
  if (result && (result.status === 'cancelled' || result.status === 'expired')) await notifyParticipants(result);
  return result;
}

async function notifyParticipants(row: ReferralRow) {
  const recipients = [...new Set([
    row.patient.userId ?? row.patient.guardianUserId,
    row.sourceClinician.userId,
    row.destinationClinician?.userId ?? null,
    row.receivedByClinician?.userId ?? null,
  ].filter((value): value is string => Boolean(value)))];
  await Promise.allSettled(recipients.map((userId) => enqueue({
    userId,
    templateKey: 'referral.update',
    vars: { referral_id: row.id },
  })));
}

async function assertFacilityConsent(
  tx: Prisma.TransactionClient, patientProfileId: string, careThreadId: string, facilityId: string, consentId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "patient_consents" WHERE "id" = ${consentId}::uuid FOR SHARE`;
  const consent = await tx.patientConsent.findUnique({ where: { id: consentId } });
  const now = new Date();
  if (!consent || consent.patientProfileId !== patientProfileId || consent.careThreadId !== careThreadId ||
      consent.granteeType !== 'facility' || consent.granteeFacilityId !== facilityId || consent.scope !== 'current_thread' ||
      !consent.allowed || consent.breakGlass || consent.revokedAt || (consent.expiresAt && consent.expiresAt <= now)) {
    throw forbidden('REFERRAL_CONSENT_REQUIRED', 'The patient must authorize this destination facility for this care thread');
  }
  return consent;
}

export async function listReferralCases(caller: ReferralCaller) {
  const clinician = await currentClinician(caller);
  const rows = await prisma.consultationRequest.findMany({
    where: {
      OR: [
        { assignedClinicianId: clinician.id },
        { careThread: { primaryClinicianId: clinician.id } },
      ],
    },
    select: {
      id: true, careThreadId: true, status: true, urgencyLevel: true, symptomText: true, createdAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return { data: rows.map((row) => ({
    consultation_id: row.id,
    care_thread_id: row.careThreadId,
    status: row.status,
    priority: row.urgencyLevel,
    clinical_summary: row.symptomText,
    created_at: row.createdAt.toISOString(),
  })) };
}

/** Return only facility grants for the exact case the caller is assigned to. */
export async function listReferralAuthorizations(consultationId: string, caller: ReferralCaller) {
  const clinician = await currentClinician(caller);
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    select: {
      patientProfileId: true,
      careThreadId: true,
      assignedClinicianId: true,
      careThread: { select: { patientProfileId: true, primaryClinicianId: true } },
    },
  });
  if (!consultation) throw notFound('Consultation not found');
  if (consultation.patientProfileId !== consultation.careThread.patientProfileId ||
      (consultation.assignedClinicianId !== clinician.id && consultation.careThread.primaryClinicianId !== clinician.id)) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not authorized to view this consultation authorization');
  }
  const rows = await prisma.patientConsent.findMany({
    where: {
      patientProfileId: consultation.patientProfileId,
      careThreadId: consultation.careThreadId,
      granteeType: 'facility',
      scope: 'current_thread',
      allowed: true,
      breakGlass: false,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      granteeFacility: { isActive: true },
    },
    include: { granteeFacility: { select: { id: true, name: true } } },
    orderBy: { grantedAt: 'desc' },
  });
  return { data: rows.filter((row) => row.granteeFacility).map((row) => ({
    consent_id: row.id,
    facility_id: row.granteeFacility!.id,
    facility_name: row.granteeFacility!.name,
    expires_at: row.expiresAt?.toISOString() ?? null,
  })) };
}

export async function createReferral(caller: ReferralCaller, input: CreateReferralInput, meta: ReferralMeta) {
  const source = await currentClinician(caller);
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: input.consultation_id },
    include: { careThread: { select: { id: true, patientProfileId: true, primaryClinicianId: true } } },
  });
  if (!consultation) throw notFound('Consultation not found');
  if (consultation.patientProfileId !== consultation.careThread.patientProfileId ||
      (consultation.assignedClinicianId !== source.id && consultation.careThread.primaryClinicianId !== source.id)) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not authorized to refer this consultation');
  }
  if (consultation.status === 'cancelled') throw unprocessable('A cancelled consultation cannot be referred', 'consultation_id');
  const destination = await prisma.facility.findUnique({ where: { id: input.destination_facility_id } });
  if (!destination || !destination.isActive) throw notFound('Active destination facility not found');
  if (input.destination_department_id) {
    const department = await prisma.department.findUnique({ where: { id: input.destination_department_id } });
    if (!department || !department.isActive || department.facilityId !== destination.id) {
      throw unprocessable('The destination department must belong to the selected active facility', 'destination_department_id');
    }
  }
  if (input.destination_clinician_id) {
    const clinician = await prisma.clinicianProfile.findFirst({
      where: {
        id: input.destination_clinician_id, facilityId: destination.id, verificationStatus: 'verified',
        user: { status: 'active' }, facility: { isActive: true },
      },
    });
    if (!clinician || (input.destination_department_id && clinician.departmentId !== input.destination_department_id)) {
      throw forbidden('REFERRAL_DESTINATION_INELIGIBLE', 'The selected clinician is not eligible at this destination');
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    await assertFacilityConsent(tx, consultation.patientProfileId, consultation.careThreadId, destination.id, input.patient_consent_id);
    const duplicateKey = `${consultation.id}:${source.id}:${destination.id}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${duplicateKey}, 0))::text AS locked`;
    const existing = await tx.digitalReferral.findFirst({
      where: {
        consultationId: consultation.id,
        sourceClinicianId: source.id,
        destinationFacilityId: destination.id,
        status: { in: [...activeStatuses] },
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) throw conflict('REFERRAL_ALREADY_EXISTS', 'An active referral already exists for this consultation and destination');
    const now = new Date();
    const consent = await tx.patientConsent.findUniqueOrThrow({ where: { id: input.patient_consent_id } });
    const expiry = new Date(now.getTime() + 14 * 24 * 60 * 60_000);
    const referral = await tx.digitalReferral.create({
      data: {
        patientProfileId: consultation.patientProfileId,
        consultationId: consultation.id,
        sourceClinicianId: source.id,
        sourceFacilityId: source.facilityId!,
        sourceDepartmentId: source.departmentId,
        destinationFacilityId: destination.id,
        destinationDepartmentId: input.destination_department_id ?? null,
        destinationClinicianId: input.destination_clinician_id ?? null,
        patientConsentId: consent.id,
        purpose: input.purpose,
        clinicalSummary: input.clinical_summary,
        priority: input.priority,
        status: 'draft',
        expiresAt: consent.expiresAt && consent.expiresAt < expiry ? consent.expiresAt : expiry,
      },
      include: referralInclude,
    });
    await audit({ caller, action: 'referral.created', id: referral.id, meta, metadata: { status: 'draft', priority: referral.priority } }, tx);
    return referral;
  });
  return serialise(created, { includeClinical: true, includeOutcome: false });
}

async function patientOwnsReferral(row: ReferralRow, caller: ReferralCaller) {
  if (caller.role !== 'patient') return false;
  const profileId = caller.ppid;
  if (!profileId || profileId !== row.patientProfileId) return false;
  return row.patient.userId === caller.sub || row.patient.guardianUserId === caller.sub;
}

async function canReadReferral(row: ReferralRow, caller: ReferralCaller) {
  if (await patientOwnsReferral(row, caller)) return { allowed: row.status !== 'draft', patient: true, clinician: null };
  if (caller.role !== 'clinician') return { allowed: false, patient: false, clinician: null };
  let clinician: Awaited<ReturnType<typeof currentClinician>>;
  try { clinician = await currentClinician(caller); } catch { return { allowed: false, patient: false, clinician: null }; }
  const source = clinician.id === row.sourceClinicianId;
  const receiving = destinationEligible(row, clinician);
  const eligibleStatus = row.status !== 'draft' || source;
  return { allowed: (source || receiving) && eligibleStatus, patient: false, clinician };
}

async function auditDenied(id: string, caller: ReferralCaller, meta: ReferralMeta, reason = 'participant_not_authorized') {
  await audit({ caller, action: 'referral.access_denied', id, meta, metadata: { reason } }).catch(() => undefined);
}

export async function getReferral(id: string, caller: ReferralCaller, meta: ReferralMeta = {}) {
  await expireOrCancelIfNeeded(id);
  const initial = await prisma.digitalReferral.findUnique({ where: { id }, include: referralInclude });
  if (!initial) throw notFound('Referral not found');
  const access = await canReadReferral(initial, caller);
  if (!access.allowed) {
    await auditDenied(id, caller, meta);
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not authorized to read this referral');
  }
  const fresh = await prisma.$transaction(async (tx) => {
    const row = await lockReferral(tx, id);
    if (!row) return null;
    const rechecked = await canReadReferral(row, caller);
    if (!rechecked.allowed) return null;
    return { row, rechecked };
  });
  if (!fresh) {
    await auditDenied(id, caller, meta);
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not authorized to read this referral');
  }
  const authorized = fresh.rechecked.patient || consentActive(fresh.row);
  const sourceMayReadSummary = fresh.row.sourceClinicianId === caller.cpid && authorized;
  const receiverMayReadSummary = Boolean(fresh.rechecked.clinician && destinationEligible(fresh.row, fresh.rechecked.clinician) && authorized);
  const includeClinical = fresh.rechecked.patient || sourceMayReadSummary || receiverMayReadSummary;
  const includeOutcome = fresh.rechecked.patient || (includeClinical && Boolean(fresh.row.outcome));
  return serialise(fresh.row, { includeClinical, includeOutcome });
}

export async function getReferralSummary(id: string, caller: ReferralCaller, meta: ReferralMeta = {}) {
  const referral = await getReferral(id, caller, meta);
  if (referral.clinical_summary == null) {
    throw forbidden('REFERRAL_CONSENT_REQUIRED', 'The authorized referral summary is unavailable');
  }
  return {
    referral_id: referral.id,
    purpose: referral.purpose,
    priority: referral.priority,
    clinical_summary: referral.clinical_summary,
    consultation_id: referral.consultation_id,
    source: referral.source,
    destination: referral.destination,
  };
}

export async function listPatientReferrals(caller: ReferralCaller) {
  if (caller.role !== 'patient' || !caller.ppid) throw forbidden('ROLE_NOT_PERMITTED', 'Patient account required');
  const profile = await prisma.patientProfile.findUnique({ where: { id: caller.ppid } });
  if (!profile || (profile.userId !== caller.sub && profile.guardianUserId !== caller.sub)) {
    throw forbidden('NOT_RESOURCE_OWNER', 'This patient profile does not belong to you');
  }
  const rows = await prisma.digitalReferral.findMany({
    where: { patientProfileId: profile.id, status: { not: 'draft' } },
    include: referralInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const data = [];
  for (const row of rows) data.push(await getReferral(row.id, caller));
  return { data };
}

export async function listSourceReferrals(caller: ReferralCaller) {
  const clinician = await currentClinician(caller);
  const rows = await prisma.digitalReferral.findMany({
    where: { sourceClinicianId: clinician.id },
    include: referralInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const data = [];
  for (const row of rows) data.push(await getReferral(row.id, caller));
  return { data };
}

export async function listInboxReferrals(caller: ReferralCaller) {
  const clinician = await currentClinician(caller);
  const rows = await prisma.digitalReferral.findMany({
    where: {
      destinationFacilityId: clinician.facilityId!,
      OR: [
        {
          status: { in: ['submitted', 'received'] },
          AND: [
            { OR: clinician.departmentId
              ? [{ destinationDepartmentId: null }, { destinationDepartmentId: clinician.departmentId }]
              : [{ destinationDepartmentId: null }] },
            { OR: [{ destinationClinicianId: null }, { destinationClinicianId: clinician.id }] },
          ],
        },
        { status: { in: ['accepted', 'in_care'] }, destinationClinicianId: clinician.id },
      ],
    },
    include: referralInclude,
    orderBy: [{ priority: 'desc' }, { submittedAt: 'asc' }],
    take: 100,
  });
  const data = [];
  for (const row of rows) {
    await expireOrCancelIfNeeded(row.id);
    const fresh = await getReferral(row.id, caller);
    if (['submitted', 'received', 'accepted', 'in_care'].includes(fresh.status) && fresh.clinical_summary !== null) data.push(fresh);
  }
  return { data };
}

type ReferralAction = 'submit' | 'receive' | 'accept' | 'decline' | 'startCare' | 'complete' | 'cancel';

async function transition(
  action: ReferralAction, id: string, caller: ReferralCaller, meta: ReferralMeta,
  input?: { reason?: string; outcome?: CompleteReferralInput },
) {
  await expireOrCancelIfNeeded(id);
  const clinician = caller.role === 'clinician' ? await currentClinician(caller) : null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await lockReferral(tx, id);
    if (!row) throw notFound('Referral not found');
    const now = new Date();
    const hasConsent = consentActive(row, now);
    if (!hasConsent && action !== 'cancel') {
      throw forbidden('REFERRAL_CONSENT_REQUIRED', 'The patient authorization is no longer active');
    }
    const source = Boolean(clinician && clinician.id === row.sourceClinicianId);
    const receiver = Boolean(clinician && destinationEligible(row, clinician));
    const patient = await patientOwnsReferral(row, caller);
    let next: Prisma.DigitalReferralUncheckedUpdateManyInput | null = null;
    let nextStatus: string | null = null;
    let event = '';
    let metadata: Record<string, unknown> = {};

    switch (action) {
      case 'submit':
        if (!source || row.status !== 'draft') throw conflict('STATE_TRANSITION_INVALID', 'Only the source clinician can submit a draft referral');
        next = { status: 'submitted', submittedAt: now, version: { increment: 1 } };
        nextStatus = 'submitted'; event = 'referral.submitted';
        break;
      case 'receive':
        if (!receiver || row.status !== 'submitted') throw conflict('STATE_TRANSITION_INVALID', 'Only an eligible receiving clinician can acknowledge a submitted referral');
        next = { status: 'received', receivedAt: now, receivedByClinicianId: clinician!.id, version: { increment: 1 } };
        nextStatus = 'received'; event = 'referral.received';
        break;
      case 'accept':
        if (!receiver || row.status !== 'received' || (row.destinationClinicianId && row.destinationClinicianId !== clinician!.id)) {
          throw conflict('STATE_TRANSITION_INVALID', 'Only the eligible receiving clinician can accept a received referral');
        }
        next = { status: 'accepted', destinationClinicianId: clinician!.id, acceptedAt: now, version: { increment: 1 } };
        nextStatus = 'accepted'; event = 'referral.accepted';
        break;
      case 'decline':
        if (!receiver || row.status !== 'received') throw conflict('STATE_TRANSITION_INVALID', 'Only an eligible receiving clinician can decline a received referral');
        next = { status: 'declined', declinedAt: now, declineReason: input?.reason, version: { increment: 1 } };
        nextStatus = 'declined'; event = 'referral.declined'; metadata = { reason_recorded: true };
        break;
      case 'startCare':
        if (!receiver || row.destinationClinicianId !== clinician!.id || row.status !== 'accepted') {
          throw conflict('STATE_TRANSITION_INVALID', 'Only the accepting clinician can start receiving care');
        }
        next = { status: 'in_care', careStartedAt: now, version: { increment: 1 } };
        nextStatus = 'in_care'; event = 'referral.care_started';
        break;
      case 'complete':
        if (!receiver || row.destinationClinicianId !== clinician!.id || row.status !== 'in_care' || !input?.outcome) {
          throw conflict('STATE_TRANSITION_INVALID', 'Only the receiving clinician may complete an in-care referral with an outcome');
        }
        next = { status: 'completed', completedAt: now, version: { increment: 1 } };
        nextStatus = 'completed'; event = 'referral.completed'; metadata = { outcome_status: input.outcome.outcome_status };
        break;
      case 'cancel':
        if (!source && !patient) throw forbidden('NOT_RESOURCE_OWNER', 'Only the source clinician or patient may cancel this referral');
        if (row.status !== 'draft' && row.status !== 'submitted' && row.status !== 'received') {
          throw conflict('STATE_TRANSITION_INVALID', 'This referral can no longer be cancelled directly; revoke its authorization if access must stop');
        }
        next = { status: 'cancelled', cancelledAt: now, cancellationReason: patient ? 'patient_cancelled' : 'source_cancelled', version: { increment: 1 } };
        nextStatus = 'cancelled'; event = 'referral.cancelled'; metadata = { reason: patient ? 'patient_cancelled' : 'source_cancelled' };
        break;
    }
    const expected = row.status;
    const changed = await tx.digitalReferral.updateMany({
      where: {
        id,
        status: expected,
        version: row.version,
        ...(['draft', 'submitted', 'received'].includes(expected) ? { expiresAt: { gt: now } } : {}),
      },
      data: next!,
    });
    if (changed.count !== 1) throw conflict('STATE_TRANSITION_INVALID', 'The referral changed or expired before this action completed');
    if (action === 'complete' && input?.outcome) {
      await tx.digitalReferralOutcome.create({
        data: {
          referralId: id,
          receivingClinicianId: clinician!.id,
          status: input.outcome.outcome_status,
          followUpRecommendation: input.outcome.follow_up_recommendation,
          patientInstructions: input.outcome.patient_instructions,
        },
      });
    }
    await audit({
      caller, action: event, id, meta,
      metadata: { from: expected, to: nextStatus, ...metadata },
    }, tx);
    return tx.digitalReferral.findUniqueOrThrow({ where: { id }, include: referralInclude });
  });
  await notifyParticipants(updated);
  return serialise(updated, { includeClinical: true, includeOutcome: true });
}

export const submitReferral = (id: string, caller: ReferralCaller, meta: ReferralMeta) => transition('submit', id, caller, meta);
export const receiveReferral = (id: string, caller: ReferralCaller, meta: ReferralMeta) => transition('receive', id, caller, meta);
export const acceptReferral = (id: string, caller: ReferralCaller, meta: ReferralMeta) => transition('accept', id, caller, meta);
export const declineReferral = (id: string, caller: ReferralCaller, reason: string, meta: ReferralMeta) => transition('decline', id, caller, meta, { reason });
export const startReferralCare = (id: string, caller: ReferralCaller, meta: ReferralMeta) => transition('startCare', id, caller, meta);
export const completeReferral = (id: string, caller: ReferralCaller, input: CompleteReferralInput, meta: ReferralMeta) => transition('complete', id, caller, meta, { outcome: input });
export const cancelReferral = (id: string, caller: ReferralCaller, meta: ReferralMeta) => transition('cancel', id, caller, meta);
