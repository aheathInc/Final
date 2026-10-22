import { createHash } from 'node:crypto';
import { prisma, type Prisma, type FrontDeskVisit } from '@a-health/database';
import { appendAudit, canonical, conflict, forbidden, notFound, recordChange, unprocessable } from '@a-health/http';
import type { Caller, Meta } from '../services/careThread.service.js';
import { env } from '../config/env.js';
import { ACTIVE_VISIT_STATUSES, actionAllowed, administrativeCheckSatisfied, clinicianReceiving,
  queueAheadWhere, readinessStatus, suggestDepartments, type VisitAction } from './domain.js';
import type { AdministrativeInput, CreateVisitInput } from './types.js';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };
const visitInclude = {
  patient: { select: { fullName: true, userId: true, guardianUserId: true } },
  facility: { select: { name: true } }, department: { select: { name: true } },
  requestedClinician: { select: { user: { select: { fullName: true } } } },
  assignedClinician: { select: { user: { select: { fullName: true } } } },
  consultation: { select: { id: true, status: true, careThreadId: true } },
} satisfies Prisma.FrontDeskVisitInclude;
type Visit = Prisma.FrontDeskVisitGetPayload<{ include: typeof visitInclude }>;

async function activeUser(tx: Tx, caller: Caller) {
  const user = await tx.user.findUnique({ where: { id: caller.sub }, select: { role: true, status: true } });
  if (!user || user.status !== 'active' || user.role !== caller.role) {
    throw forbidden('ROLE_NOT_PERMITTED', 'Active account required');
  }
}
async function admin(tx: Tx, caller: Caller) {
  await activeUser(tx, caller);
  if (caller.role !== 'platform_admin') throw forbidden('ROLE_NOT_PERMITTED', 'Platform administrator required');
}
async function clinician(tx: Tx, caller: Caller) {
  await activeUser(tx, caller);
  if (caller.role !== 'clinician' || !caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician required');
  const profile = await tx.clinicianProfile.findUnique({
    where: { id: caller.cpid }, include: { user: true, facility: true, department: true },
  });
  if (!profile || profile.userId !== caller.sub || profile.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Verified clinician required');
  }
  if (!profile.facility?.isActive || !profile.department?.isActive || profile.department.facilityId !== profile.facilityId) {
    throw forbidden('FACILITY_MEMBERSHIP_REQUIRED', 'Active facility and department membership required');
  }
  return profile;
}
async function owner(tx: Tx, caller: Caller, patientId: string) {
  await activeUser(tx, caller);
  if (caller.role !== 'patient') throw forbidden('ROLE_NOT_PERMITTED', 'Patient account required');
  const patient = await tx.patientProfile.findUnique({ where: { id: patientId } });
  if (!patient || (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub)) {
    throw forbidden('NOT_RESOURCE_OWNER', 'This patient profile is not yours');
  }
  return patient;
}
async function staffScope(tx: Tx, caller: Caller, facilityId: string, departmentId?: string) {
  if (caller.role === 'platform_admin') { await admin(tx, caller); return null; }
  const profile = await clinician(tx, caller);
  if (profile.facilityId !== facilityId || (departmentId && profile.departmentId !== departmentId)) {
    throw forbidden('FACILITY_MEMBERSHIP_REQUIRED', 'This queue is outside your department');
  }
  return profile;
}
async function enabledFacility(tx: Tx, id: string) {
  // A configuration update waits for any admitted write to finish.
  await tx.$queryRaw`SELECT id FROM facilities WHERE id = ${id}::uuid FOR SHARE`;
  const facility = await tx.facility.findUnique({ where: { id } });
  if (!facility?.isActive || !facility.digitalDeskEnabled) {
    throw conflict('FRONT_DESK_DISABLED', 'Digital front desk is not enabled for this facility');
  }
  return facility;
}
async function department(tx: Tx, facilityId: string, id: string) {
  const row = await tx.department.findUnique({ where: { id } });
  if (!row?.isActive || row.facilityId !== facilityId) throw notFound('Active department not found in this facility');
  return row;
}
function serialise(visit: Visit, includePurpose: boolean) {
  return {
    id: visit.id, ticket: `AHP-${visit.ticketNumber}`, status: visit.status, version: visit.version,
    patient_profile_id: visit.patientProfileId,
    // A patient expressly shares this intake with their chosen department;
    // this does not grant this department access to the full health record.
    patient_name: visit.patient.fullName,
    ...(includePurpose ? { purpose: visit.purpose } : {}),
    facility: { id: visit.facilityId, name: visit.facility.name },
    department: { id: visit.departmentId, name: visit.department.name },
    requested_clinician: visit.requestedClinicianId ? { id: visit.requestedClinicianId, name: visit.requestedClinician?.user.fullName ?? null } : null,
    assigned_clinician: visit.assignedClinicianId ? { id: visit.assignedClinicianId, name: visit.assignedClinician?.user.fullName ?? null } : null,
    consultation_id: visit.consultationId, care_thread_id: visit.consultation?.careThreadId ?? null,
    consultation_status: visit.consultation?.status ?? null,
    requirements: { payment: visit.paymentRequired, insurance: visit.insuranceRequired, clinical_review: true },
    clearance: {
      registration: visit.administrativeAt ? 'manually_confirmed' : 'pending',
      payment: visit.paymentCheck, insurance: visit.insuranceCheck, clinical_review: visit.triageStatus,
      method: 'manual_facility_review',
    },
    // No confidential external verification references, request key/hash or tokens.
    checked_in_at: visit.checkedInAt?.toISOString() ?? null,
    ready_at: visit.readyAt?.toISOString() ?? null, called_at: visit.calledAt?.toISOString() ?? null,
    started_at: visit.startedAt?.toISOString() ?? null, completed_at: visit.completedAt?.toISOString() ?? null,
    created_at: visit.createdAt.toISOString(), updated_at: visit.updatedAt.toISOString(),
    coverage: 'AHP_REGISTERED_VISITS_ONLY', estimated_wait_minutes: null,
  };
}
async function audit(tx: Tx, caller: Caller, visit: FrontDeskVisit, action: string, meta: Meta) {
  await appendAudit({ actorUserId: caller.sub, action: `frontdesk.${action}`,
    entityType: 'front_desk_visits', entityId: visit.id,
    metadata: { facilityId: visit.facilityId, departmentId: visit.departmentId, status: visit.status, version: visit.version },
    ipAddress: meta.ip, requestId: meta.requestId }, tx);
}
async function lockedVisit(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM front_desk_visits WHERE id = ${id}::uuid FOR UPDATE`;
  const visit = await tx.frontDeskVisit.findUnique({ where: { id }, include: visitInclude });
  if (!visit) throw notFound('Visit not found');
  return visit;
}
function versionCheck(visit: FrontDeskVisit, base: number) {
  if (visit.version !== base) throw conflict('VERSION_CONFLICT', 'Visit changed. Reload before trying again.');
}
function requireAction(visit: FrontDeskVisit, action: VisitAction) {
  if (!actionAllowed(visit.status, action)) throw conflict('STATE_TRANSITION_INVALID', `Cannot ${action} at this stage`);
}
function queuePreparation(visit: FrontDeskVisit, changes: Partial<FrontDeskVisit>, now: Date) {
  const candidate = { ...visit, ...changes };
  const status = readinessStatus(candidate);
  return { status, readyAt: status === 'waiting' ? (visit.readyAt ?? now) : null };
}
async function mapUnique<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw conflict('DUPLICATE_RESOURCE', 'An active visit or clinician allocation already exists. Reload the queue.');
    }
    throw error;
  }
}

export async function listDeskFacilities(caller: Caller, query: { cursor?: string; limit: number }) {
  return prisma.$transaction(async (tx) => {
    await activeUser(tx, caller);
    const rows = await tx.facility.findMany({
      where: { isActive: true, ...(caller.role === 'platform_admin' ? {} : { digitalDeskEnabled: true }) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, name: true, regionCode: true, version: true, digitalDeskEnabled: true, deskPaymentRequired: true, deskInsuranceRequired: true },
    });
    return { data: rows.slice(0, query.limit).map((f) => ({
      id: f.id, name: f.name, region_code: f.regionCode, version: f.version, enabled: f.digitalDeskEnabled,
      payment_required: f.deskPaymentRequired, insurance_required: f.deskInsuranceRequired,
      clinical_review_required: true, coverage: 'AHP_REGISTERED_VISITS_ONLY',
    })), meta: { has_more: rows.length > query.limit, next_cursor: rows.length > query.limit ? rows[query.limit - 1].id : null } };
  }, TX_OPTIONS);
}

export async function configureDesk(caller: Caller, facilityId: string,
  input: { base_version: number; enabled: boolean; payment_required: boolean; insurance_required: boolean }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    await admin(tx, caller);
    const changed = await tx.facility.updateMany({ where: { id: facilityId, isActive: true, version: input.base_version }, data: {
      digitalDeskEnabled: input.enabled, deskPaymentRequired: input.payment_required, deskInsuranceRequired: input.insurance_required,
      version: { increment: 1 },
    } });
    if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Active facility changed or was not found. Reload.');
    await appendAudit({ actorUserId: caller.sub, action: 'frontdesk.policy_updated', entityType: 'facilities', entityId: facilityId,
      metadata: { enabled: input.enabled, paymentRequired: input.payment_required, insuranceRequired: input.insurance_required },
      ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { facility_id: facilityId, version: input.base_version + 1 };
  }, TX_OPTIONS);
}

export async function listDeskDepartments(caller: Caller, facilityId: string) {
  return prisma.$transaction(async (tx) => {
    await activeUser(tx, caller);
    if (caller.role === 'platform_admin') {
      const f = await tx.facility.findUnique({ where: { id: facilityId } });
      if (!f?.isActive) throw notFound('Active facility not found');
    } else await enabledFacility(tx, facilityId);
    const rows = await tx.department.findMany({ where: { facilityId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return { data: rows.map((d) => ({ id: d.id, name: d.name, specialty: d.specialty, version: d.version,
      ...(caller.role === 'platform_admin' ? { navigation_aliases: d.navigationAliases } : {}) })) };
  }, TX_OPTIONS);
}
export async function configureAliases(caller: Caller, facilityId: string, departmentId: string,
  input: { base_version: number; aliases: string[] }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    await admin(tx, caller); await department(tx, facilityId, departmentId);
    const aliases = [...new Set(input.aliases.map((s) => s.trim().toLocaleLowerCase('en')))];
    const result = await tx.department.updateMany({ where: { id: departmentId, facilityId, version: input.base_version }, data: { navigationAliases: aliases, version: { increment: 1 } } });
    if (result.count !== 1) throw conflict('VERSION_CONFLICT', 'Department changed. Reload.');
    await appendAudit({ actorUserId: caller.sub, action: 'frontdesk.navigation_labels_updated', entityType: 'departments', entityId: departmentId,
      metadata: { aliasCount: aliases.length }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { department_id: departmentId, version: input.base_version + 1 };
  }, TX_OPTIONS);
}
export async function navigateDepartment(caller: Caller, facilityId: string, text: string) {
  return prisma.$transaction(async (tx) => {
    await activeUser(tx, caller); await enabledFacility(tx, facilityId);
    const rows = await tx.department.findMany({ where: { facilityId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    // Navigation text is deliberately not persisted, logged or sent to an external model.
    return suggestDepartments(text, rows);
  }, TX_OPTIONS);
}

export async function getDepartmentBoard(caller: Caller, facilityId: string, departmentId: string) {
  return prisma.$transaction(async (tx) => {
    await activeUser(tx, caller); await enabledFacility(tx, facilityId); await department(tx, facilityId, departmentId);
    const now = new Date();
    const providers = await tx.clinicianProfile.findMany({
      where: { facilityId, departmentId, verificationStatus: 'verified', user: { role: 'clinician', status: 'active' } },
      include: { user: { select: { fullName: true, status: true, role: true } } }, orderBy: { id: 'asc' }, take: 100,
    });
    const waiting = await tx.frontDeskVisit.groupBy({ by: ['requestedClinicianId'], where: { facilityId, departmentId, status: 'waiting' }, _count: { _all: true } });
    const activity = await tx.consultationRequest.groupBy({ by: ['assignedClinicianId'], where: {
      assignedClinicianId: { in: providers.map((p) => p.id) }, status: { in: ['matched', 'in_progress'] },
    }, _count: { _all: true } });
    return {
      facility_id: facilityId, department_id: departmentId, observed_at: now.toISOString(),
      coverage: 'AHP_REGISTERED_VISITS_ONLY', estimated_wait_minutes: null,
      department_pool_waiting: waiting.find((w) => w.requestedClinicianId === null)?._count._all ?? 0,
      providers: providers.map((p) => ({ id: p.id, full_name: p.user.fullName, specialty: p.specialty,
        receiving_new_patients: clinicianReceiving(p, now), available_until: p.availableUntil?.toISOString() ?? null,
        waiting_for_this_clinician: waiting.find((w) => w.requestedClinicianId === p.id)?._count._all ?? 0,
        active_ahp_consultations: activity.find((a) => a.assignedClinicianId === p.id)?._count._all ?? 0,
      })),
    };
  }, { ...TX_OPTIONS, isolationLevel: 'RepeatableRead' });
}

export async function createVisit(caller: Caller, input: CreateVisitInput, meta: Meta) {
  if (input.urgent_help_requested) throw conflict('FRONT_DESK_URGENT_REVIEW', 'Seek assistance from hospital staff now. Do not rely on the digital queue for urgent help.');
  if (input.share_with_department !== true) throw forbidden('CONSENT_REQUIRED', 'Department intake sharing permission required');
  const patientId = input.patient_profile_id ?? caller.ppid;
  if (!patientId) throw forbidden('NOT_RESOURCE_OWNER', 'Patient profile required');
  const hash = createHash('sha256').update(canonical({
    patientId, facilityId: input.facility_id, departmentId: input.department_id,
    clinicianId: input.requested_clinician_id ?? null, purpose: input.purpose.trim(), departmentShare: true,
  })).digest('hex');
  return mapUnique(() => prisma.$transaction(async (tx) => {
    await owner(tx, caller, patientId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`frontdesk:${patientId}:${input.facility_id}`}, 0))::text AS locked`;
    const previous = await tx.frontDeskVisit.findUnique({ where: { patientProfileId_requestKey: { patientProfileId: patientId, requestKey: input.request_key } }, include: visitInclude });
    if (previous) {
      if (previous.requestHash !== hash) throw conflict('IDEMPOTENCY_KEY_CONFLICT', 'This request key was used with different input');
      return serialise(previous, true);
    }
    const facility = await enabledFacility(tx, input.facility_id);
    await department(tx, facility.id, input.department_id);
    const existing = await tx.frontDeskVisit.findFirst({ where: { patientProfileId: patientId, facilityId: facility.id, status: { in: ACTIVE_VISIT_STATUSES } } });
    if (existing) throw conflict('FRONT_DESK_VISIT_EXISTS', 'You already have an active visit at this facility. Open My Visits.');
    if (input.requested_clinician_id) {
      const selected = await tx.clinicianProfile.findUnique({ where: { id: input.requested_clinician_id }, include: { user: true } });
      if (!selected || selected.facilityId !== facility.id || selected.departmentId !== input.department_id || !clinicianReceiving(selected, new Date())) {
        throw conflict('CLINICIAN_UNAVAILABLE', 'Selected clinician is not currently receiving patients in this department');
      }
    }
    const now = new Date();
    const visit = await tx.frontDeskVisit.create({ data: {
      patientProfileId: patientId, createdByUserId: caller.sub, facilityId: facility.id, departmentId: input.department_id,
      requestedClinicianId: input.requested_clinician_id ?? null, purpose: input.purpose.trim(), departmentShareAt: now,
      paymentRequired: facility.deskPaymentRequired, insuranceRequired: facility.deskInsuranceRequired,
      requestKey: input.request_key, requestHash: hash,
    }, include: visitInclude });
    await audit(tx, caller, visit, 'preregistered', meta);
    return serialise(visit, true);
  }, TX_OPTIONS));
}

export async function listMyVisits(caller: Caller, query: { patient_profile_id?: string; cursor?: string; limit: number }) {
  const patientId = query.patient_profile_id ?? caller.ppid;
  if (!patientId) throw forbidden('NOT_RESOURCE_OWNER', 'Patient profile required');
  return prisma.$transaction(async (tx) => {
    await owner(tx, caller, patientId);
    const rows = await tx.frontDeskVisit.findMany({ where: { patientProfileId: patientId }, include: visitInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return { data: rows.slice(0, query.limit).map((v) => serialise(v, true)),
      meta: { has_more: rows.length > query.limit, next_cursor: rows.length > query.limit ? rows[query.limit - 1].id : null } };
  }, TX_OPTIONS);
}
export async function listStaffVisits(caller: Caller, query: { facility_id: string; department_id?: string; status?: FrontDeskVisit['status']; cursor?: string; limit: number }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const profile = await staffScope(tx, caller, query.facility_id, query.department_id);
    const rows = await tx.frontDeskVisit.findMany({
      where: { facilityId: query.facility_id, departmentId: profile?.departmentId ?? query.department_id,
        status: query.status ? query.status : { in: ACTIVE_VISIT_STATUSES } }, include: visitInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    await appendAudit({ actorUserId: caller.sub, action: 'frontdesk.queue_viewed', entityType: 'facilities', entityId: query.facility_id,
      metadata: { count: Math.min(rows.length, query.limit) }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { data: rows.slice(0, query.limit).map((v) => serialise(v, caller.role === 'clinician')),
      meta: { has_more: rows.length > query.limit, next_cursor: rows.length > query.limit ? rows[query.limit - 1].id : null } };
  }, TX_OPTIONS);
}
export async function getVisit(caller: Caller, id: string, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const visit = await tx.frontDeskVisit.findUnique({ where: { id }, include: visitInclude });
    if (!visit) throw notFound('Visit not found');
    if (caller.role === 'patient') await owner(tx, caller, visit.patientProfileId);
    else await staffScope(tx, caller, visit.facilityId, visit.departmentId);
    const ahead = visit.status === 'waiting' ? await tx.frontDeskVisit.count({ where: queueAheadWhere(visit) }) : null;
    await audit(tx, caller, visit, 'viewed', meta);
    return { ...serialise(visit, caller.role !== 'platform_admin'),
      queue_position: ahead === null ? null : ahead + 1, ahead_of_you: ahead,
      queue_scope: visit.requestedClinicianId ? 'facility_department_requested_clinician' : 'facility_department_pool',
      observed_at: new Date().toISOString(),
    };
  }, { ...TX_OPTIONS, isolationLevel: 'RepeatableRead' });
}

export async function checkInVisit(caller: Caller, id: string, baseVersion: number, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const visit = await lockedVisit(tx, id); await owner(tx, caller, visit.patientProfileId);
    await enabledFacility(tx, visit.facilityId); await department(tx, visit.facilityId, visit.departmentId);
    versionCheck(visit, baseVersion); requireAction(visit, 'check-in');
    const now = new Date();
    const changes = { checkedInAt: now };
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { ...changes, ...queuePreparation(visit, changes, now), version: { increment: 1 } }, include: visitInclude });
    await audit(tx, caller, updated, 'arrival_declared', meta);
    return serialise(updated, true);
  }, TX_OPTIONS);
}
export async function administrativeReview(caller: Caller, id: string, input: AdministrativeInput, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    await admin(tx, caller);
    const visit = await lockedVisit(tx, id); await enabledFacility(tx, visit.facilityId);
    await department(tx, visit.facilityId, visit.departmentId);
    versionCheck(visit, input.base_version); requireAction(visit, 'administrative-review');
    if (!input.registration_confirmed || !administrativeCheckSatisfied(visit.paymentRequired, input.payment_check)
      || !administrativeCheckSatisfied(visit.insuranceRequired, input.insurance_check)) {
      throw unprocessable('Required checks cannot be marked not required');
    }
    if ((input.payment_check === 'manually_verified' && !input.payment_reference)
      || (input.insurance_check === 'manually_verified' && !input.insurance_reference)) {
      throw unprocessable('A manual verification reference is required. Do not enter financial account numbers.');
    }
    const now = new Date();
    const changes = { administrativeAt: now, administrativeBy: caller.sub,
      paymentCheck: input.payment_check, insuranceCheck: input.insurance_check,
      paymentReference: input.payment_check === 'manually_verified' ? input.payment_reference! : null,
      insuranceReference: input.insurance_check === 'manually_verified' ? input.insurance_reference! : null };
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { ...changes, ...queuePreparation(visit, changes, now), version: { increment: 1 } }, include: visitInclude });
    await audit(tx, caller, updated, 'administrative_review_recorded', meta);
    return serialise(updated, false);
  }, TX_OPTIONS);
}
export async function clinicalReview(caller: Caller, id: string, input: { base_version: number; decision: 'cleared' | 'escalated' }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const visit = await lockedVisit(tx, id);
    const profile = await clinician(tx, caller);
    if (profile.facilityId !== visit.facilityId || profile.departmentId !== visit.departmentId) throw forbidden('FACILITY_MEMBERSHIP_REQUIRED', 'Review is limited to your department');
    await enabledFacility(tx, visit.facilityId); versionCheck(visit, input.base_version); requireAction(visit, 'clinical-review');
    const now = new Date();
    const changes = { triageStatus: input.decision, triageAt: now, triageBy: profile.id };
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { ...changes, ...queuePreparation(visit, changes, now), version: { increment: 1 } }, include: visitInclude });
    await audit(tx, caller, updated, input.decision === 'cleared' ? 'clinical_queue_cleared' : 'clinical_review_escalated', meta);
    return serialise(updated, true);
  }, TX_OPTIONS);
}
export async function callVisit(caller: Caller, id: string, baseVersion: number, meta: Meta) {
  return mapUnique(() => prisma.$transaction(async (tx) => {
    const visit = await lockedVisit(tx, id);
    await staffScope(tx, caller, visit.facilityId, visit.departmentId);
    versionCheck(visit, baseVersion); requireAction(visit, 'call');
    // Take the clinician row lock before reading availability/membership.
    if (caller.cpid) await tx.$queryRaw`SELECT id FROM clinician_profiles WHERE id = ${caller.cpid}::uuid FOR UPDATE`;
    const profile = await clinician(tx, caller);
    if (profile.facilityId !== visit.facilityId || profile.departmentId !== visit.departmentId
      || (visit.requestedClinicianId && visit.requestedClinicianId !== profile.id)) {
      throw forbidden('FACILITY_MEMBERSHIP_REQUIRED', 'This visit is not in your clinician queue');
    }
    await enabledFacility(tx, visit.facilityId);
    if (!clinicianReceiving(profile, new Date())) throw conflict('CLINICIAN_UNAVAILABLE', 'Set your current availability before calling a patient');
    // One called/in-person patient per clinician; the partial unique index is the backstop.
    const busy = await tx.frontDeskVisit.count({ where: { assignedClinicianId: profile.id, status: { in: ['called','in_consultation'] } } });
    if (busy) throw conflict('CLINICIAN_UNAVAILABLE', 'Finish or cancel the existing front-desk visit first');
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { status: 'called', assignedClinicianId: profile.id, calledAt: new Date(), version: { increment: 1 } }, include: visitInclude });
    await audit(tx, caller, updated, 'called', meta);
    return serialise(updated, true);
  }, TX_OPTIONS));
}
export async function startVisit(caller: Caller, id: string, baseVersion: number, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const visit = await lockedVisit(tx, id);
    await staffScope(tx, caller, visit.facilityId, visit.departmentId);
    versionCheck(visit, baseVersion); requireAction(visit, 'start');
    if (caller.cpid) await tx.$queryRaw`SELECT id FROM clinician_profiles WHERE id = ${caller.cpid}::uuid FOR UPDATE`;
    const profile = await clinician(tx, caller);
    if (visit.assignedClinicianId !== profile.id || profile.facilityId !== visit.facilityId || profile.departmentId !== visit.departmentId) {
      throw forbidden('NOT_RESOURCE_OWNER', 'Only the assigned department clinician can start this visit');
    }
    await enabledFacility(tx, visit.facilityId);
    if (!clinicianReceiving(profile, new Date())) throw conflict('CLINICIAN_UNAVAILABLE', 'Clinician availability has expired');
    const now = new Date();
    const thread = await tx.careThread.create({ data: { patientProfileId: visit.patientProfileId, primaryClinicianId: profile.id, reasonSummary: visit.purpose.slice(0, 300), openConsultationCount: 1 } });
    const consultation = await tx.consultationRequest.create({ data: {
      careThreadId: thread.id, patientProfileId: visit.patientProfileId, assignedClinicianId: profile.id,
      channel: 'app', modality: 'chat', symptomText: visit.purpose, structuredSymptoms: [],
      urgencyLevel: 'routine', triageRuleVersion: 'front-desk-human-clearance-v1', status: 'in_progress',
      slaDeadlineAt: new Date(now.getTime() + env.SLA_ROUTINE_SECONDS * 1000), acceptedAt: now,
    } });
    await tx.careThread.update({ where: { id: thread.id }, data: { latestConsultationId: consultation.id } });
    await tx.clinicianProfile.update({ where: { id: profile.id }, data: { currentLoad: { increment: 1 }, version: { increment: 1 } } });
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { consultationId: consultation.id, status: 'in_consultation', startedAt: now, version: { increment: 1 } }, include: visitInclude });
    await recordChange(tx, { entity: 'care_threads', entityId: thread.id, op: 'create', version: thread.version, patientProfileId: visit.patientProfileId, careThreadId: thread.id });
    await recordChange(tx, { entity: 'consultation_requests', entityId: consultation.id, op: 'create', version: consultation.version, patientProfileId: visit.patientProfileId, careThreadId: thread.id });
    await audit(tx, caller, updated, 'consultation_started', meta);
    return serialise(updated, true);
  }, TX_OPTIONS);
}
export async function cancelVisit(caller: Caller, id: string, baseVersion: number, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    const visit = await lockedVisit(tx, id);
    if (caller.role === 'patient') await owner(tx, caller, visit.patientProfileId);
    else await staffScope(tx, caller, visit.facilityId, visit.departmentId);
    versionCheck(visit, baseVersion); requireAction(visit, 'cancel');
    const updated = await tx.frontDeskVisit.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), version: { increment: 1 } }, include: visitInclude });
    await audit(tx, caller, updated, 'cancelled', meta);
    return serialise(updated, caller.role !== 'platform_admin');
  }, TX_OPTIONS);
}
