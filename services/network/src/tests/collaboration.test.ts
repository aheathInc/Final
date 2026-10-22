import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { verifyAuditChain, type AppError } from '@a-health/http';
import * as collaborations from '../services/collaboration.service.js';
import * as patientConsents from '../../../patient/src/services/consent.service.js';
import { listLedgerEvents } from '../../../auth/src/services/ledger.service.js';

const databaseUrl = process.env.DATABASE_URL ?? '';
let testDatabase: URL;
try { testDatabase = new URL(databaseUrl); } catch {
  throw new Error('Refusing collaboration tests without a valid local ahealth_test DATABASE_URL.');
}
const testDatabaseName = decodeURIComponent(testDatabase.pathname.replace(/^\//, ''));
if (
  testDatabaseName !== 'ahealth_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(testDatabase.hostname) ||
  (testDatabase.port || '5432') === '5432'
) {
  throw new Error('Refusing collaboration tests unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
}

const meta = { ip: '127.0.0.1', requestId: 'provider-collaboration-test' };
const userIds: string[] = [];
const clinicianIds: string[] = [];
const facilityIds: string[] = [];
const departmentIds: string[] = [];
const patientProfileIds: string[] = [];
const careThreadIds: string[] = [];
const consultationIds: string[] = [];
const consentIds: string[] = [];
const collaborationIds: string[] = [];

after(async () => {
  await prisma.providerClinicalCollaboration.deleteMany({ where: { id: { in: collaborationIds } } }).catch(() => undefined);
  await prisma.patientConsent.deleteMany({ where: { id: { in: consentIds } } }).catch(() => undefined);
  await prisma.consultationRequest.deleteMany({ where: { id: { in: consultationIds } } }).catch(() => undefined);
  await prisma.careThread.deleteMany({ where: { id: { in: careThreadIds } } }).catch(() => undefined);
  await prisma.patientProfile.deleteMany({ where: { id: { in: patientProfileIds } } }).catch(() => undefined);
  await prisma.clinicianProfile.deleteMany({ where: { id: { in: clinicianIds } } }).catch(() => undefined);
  await prisma.department.deleteMany({ where: { id: { in: departmentIds } } }).catch(() => undefined);
  await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function makeFacility(name: string) {
  const facility = await prisma.facility.create({ data: { name: `${name} ${randomUUID().slice(0, 8)}`, type: 'clinic' } });
  facilityIds.push(facility.id);
  const firstDepartment = await prisma.department.create({
    data: { facilityId: facility.id, name: `General ${randomUUID().slice(0, 6)}`, specialty: 'general_practice' },
  });
  departmentIds.push(firstDepartment.id);
  return { facility, department: firstDepartment };
}

async function makeDepartment(facilityId: string, name: string, specialty: 'general_practice' | 'other') {
  const department = await prisma.department.create({
    data: { facilityId, name: `${name} ${randomUUID().slice(0, 6)}`, specialty },
  });
  departmentIds.push(department.id);
  return department;
}

async function makeClinician(
  facilityId: string,
  departmentId: string,
  verificationStatus: 'verified' | 'pending' = 'verified',
) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@collaboration.test`,
      role: 'clinician', status: 'active', fullName: 'Synthetic Collaboration Clinician',
    },
  });
  userIds.push(user.id);
  const clinician = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `COLLAB-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus,
      facilityId,
      departmentId,
    },
  });
  clinicianIds.push(clinician.id);
  return { sub: user.id, role: 'clinician', cpid: clinician.id };
}

async function makeCase(requester: { cpid: string }) {
  const patientUser = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient', status: 'active', fullName: 'Synthetic Case Patient',
    },
  });
  userIds.push(patientUser.id);
  const patient = await prisma.patientProfile.create({ data: { userId: patientUser.id, fullName: 'Synthetic Case Patient' } });
  patientProfileIds.push(patient.id);
  const thread = await prisma.careThread.create({
    data: { patientProfileId: patient.id, primaryClinicianId: requester.cpid, reasonSummary: 'Synthetic collaboration case' },
  });
  careThreadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id,
      patientProfileId: patient.id,
      assignedClinicianId: requester.cpid,
      channel: 'web',
      urgencyLevel: 'routine',
      triageRuleVersion: 'collaboration-test',
      status: 'in_progress',
      symptomText: 'Synthetic symptom summary for access-control tests',
      structuredSymptoms: [{ code: 'SYNTHETIC' }],
      slaDeadlineAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  consultationIds.push(consultation.id);
  return { patientId: patient.id, patientUserId: patientUser.id, careThreadId: thread.id, consultationId: consultation.id };
}

async function grantThreadConsent(
  patientProfileId: string, careThreadId: string, invitedClinicianId: string, expiresAt?: Date,
) {
  const consent = await prisma.patientConsent.create({
    data: {
      patientProfileId,
      careThreadId,
      granteeType: 'clinician',
      granteeClinicianId: invitedClinicianId,
      scope: 'current_thread',
      allowed: true,
      breakGlass: false,
      reason: 'Synthetic provider collaboration acceptance fixture',
      expiresAt: expiresAt ?? null,
    },
  });
  consentIds.push(consent.id);
  return consent;
}

async function requestAndAccept(
  requester: { sub: string; role: string; cpid: string },
  invitee: { sub: string; role: string; cpid: string },
  consultationId: string,
) {
  const requested = await collaborations.requestCollaboration(requester, {
    consultation_id: consultationId,
    invited_clinician_id: invitee.cpid,
    question: 'Synthetic question: please review the limited consultation summary.',
  }, meta);
  collaborationIds.push(requested.id);
  const incoming = await collaborations.listCollaborations(invitee, { limit: 50 });
  const incomingItems = incoming.data as Array<{ id: string }>;
  assert.ok(incomingItems.some((item) => item.id === requested.id));
  const accepted = await collaborations.acceptCollaboration(requested.id, invitee, meta);
  assert.equal(accepted.status, 'accepted');
  return accepted;
}

describe('provider clinical collaboration', () => {
  it('supports same-facility, same-department case sharing and provider-only discussion', async () => {
    const context = await makeFacility('Same facility');
    const requester = await makeClinician(context.facility.id, context.department.id);
    const invitee = await makeClinician(context.facility.id, context.department.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);

    const eligible = await collaborations.listEligibleClinicians(record.consultationId, requester);
    assert.ok(eligible.data.some((clinician) => clinician.clinician_id === invitee.cpid));
    const accepted = await requestAndAccept(requester, invitee, record.consultationId);
    const shared = await collaborations.getSharedCase(accepted.id, invitee, meta);
    assert.equal(shared.case.consultation_id, record.consultationId);
    assert.equal('patient_profile_id' in shared.case, false);
    assert.equal('patient' in shared.case, false);

    const first = await collaborations.createCollaborationMessage(accepted.id, requester,
      'Synthetic provider-only message.', meta);
    const reply = await collaborations.createCollaborationMessage(accepted.id, invitee,
      'Synthetic provider-only reply.', meta);
    assert.equal(first.author_clinician_id, requester.cpid);
    assert.equal(reply.author_clinician_id, invitee.cpid);
    const messages = await collaborations.listCollaborationMessages(accepted.id, requester, { limit: 50 }, meta);
    const discussionMessages = messages.data as Array<{ body: string }>;
    assert.deepEqual(discussionMessages.map((message) => message.body), [
      'Synthetic provider-only message.', 'Synthetic provider-only reply.',
    ]);
    assert.equal(await prisma.message.count({ where: { careThreadId: record.careThreadId } }), 0,
      'provider-only discussion must not appear in patient-facing care-thread messaging');
    const events = await prisma.auditLog.findMany({
      where: { entityType: 'provider_clinical_collaborations', entityId: accepted.id },
      select: { action: true, metadata: true },
    });
    assert.ok(events.some((event) => event.action === 'provider_collaboration.case_access_granted'));
    assert.ok(events.some((event) => event.action === 'provider_collaboration.message_recorded'));
    assert.ok(events.every((event) => JSON.stringify(event.metadata).includes('Synthetic provider-only') === false),
      'audit metadata must not store collaboration message bodies');
    const ledger = await listLedgerEvents({ category: 'collaboration', limit: 100 });
    const safeEvent = ledger.data.find((event) => event.resource_id === accepted.id && event.event_type === 'provider_collaboration.message_recorded');
    assert.ok(safeEvent);
    assert.deepEqual(safeEvent.details, { scope: 'consultation_summary' });
    assert.equal((await verifyAuditChain()).ok, true);

    const outsiderFacility = await makeFacility('Unrelated facility');
    const outsider = await makeClinician(outsiderFacility.facility.id, outsiderFacility.department.id);
    await assert.rejects(
      () => collaborations.getSharedCase(accepted.id, outsider, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER',
    );
    const patientBCase = await makeCase(outsider);
    await assert.rejects(
      () => collaborations.listEligibleClinicians(patientBCase.consultationId, invitee),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER',
      'a collaborator cannot enumerate a different patient case',
    );
  });

  it('supports same-facility cross-department sharing only with named patient consent', async () => {
    const facility = await makeFacility('Cross-department facility');
    const radiology = await makeDepartment(facility.facility.id, 'Radiology', 'other');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const invitee = await makeClinician(facility.facility.id, radiology.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);

    const accepted = await requestAndAccept(requester, invitee, record.consultationId);
    assert.equal(accepted.requester.facility_id, accepted.invited.facility_id);
    assert.notEqual(accepted.requester.department_id, accepted.invited.department_id);
    assert.equal((await collaborations.getSharedCase(accepted.id, invitee, meta)).scope, 'consultation_summary');
  });

  it('supports cross-facility sharing through explicit clinician-specific consent', async () => {
    const firstFacility = await makeFacility('Facility one');
    const secondFacility = await makeFacility('Facility two');
    const requester = await makeClinician(firstFacility.facility.id, firstFacility.department.id);
    const invitee = await makeClinician(secondFacility.facility.id, secondFacility.department.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);

    const accepted = await requestAndAccept(requester, invitee, record.consultationId);
    assert.notEqual(accepted.requester.facility_id, accepted.invited.facility_id);
    assert.equal((await collaborations.getSharedCase(accepted.id, invitee, meta)).case.consultation_id, record.consultationId);
  });

  it('fails closed without consent, for an unverified invitee, and for a clinician not involved in the case', async () => {
    const facility = await makeFacility('Authorization facility');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const unverified = await makeClinician(facility.facility.id, facility.department.id, 'pending');
    const stranger = await makeClinician(facility.facility.id, facility.department.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, unverified.cpid);

    await assert.rejects(
      () => collaborations.requestCollaboration(requester, {
        consultation_id: record.consultationId,
        invited_clinician_id: unverified.cpid,
        question: 'Synthetic question',
      }, meta),
      (error: AppError) => error.code === 'COLLABORATOR_NOT_ELIGIBLE',
    );
    await assert.rejects(
      () => collaborations.requestCollaboration(requester, {
        consultation_id: record.consultationId,
        invited_clinician_id: stranger.cpid,
        question: 'Synthetic question',
      }, meta),
      (error: AppError) => error.code === 'PATIENT_CONSENT_REQUIRED',
    );
    await assert.rejects(
      () => collaborations.listEligibleClinicians(record.consultationId, stranger),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER',
    );
    await assert.rejects(
      () => collaborations.listCollaborations({ sub: stranger.sub, role: 'platform_admin', cpid: requester.cpid }, { limit: 50 }),
      (error: AppError) => error.code === 'ROLE_NOT_PERMITTED',
    );
    await assert.rejects(
      () => collaborations.listCollaborativeCases({ sub: stranger.sub, role: 'clinician', cpid: requester.cpid }, { limit: 50 }),
      (error: AppError) => error.code === 'CLINICIAN_NOT_VERIFIED',
    );
  });

  it('supports decline and participant revocation, immediately denying case and discussion access', async () => {
    const facility = await makeFacility('Lifecycle facility');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const invitee = await makeClinician(facility.facility.id, facility.department.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);

    const declinedRequest = await collaborations.requestCollaboration(requester, {
      consultation_id: record.consultationId,
      invited_clinician_id: invitee.cpid,
      question: 'Synthetic decline test.',
    }, meta);
    collaborationIds.push(declinedRequest.id);
    assert.equal((await collaborations.declineCollaboration(declinedRequest.id, invitee, meta)).status, 'declined');

    const active = await requestAndAccept(requester, invitee, record.consultationId);
    await collaborations.createCollaborationMessage(active.id, requester, 'Before revocation.', meta);
    assert.equal((await collaborations.revokeCollaboration(active.id, requester, meta)).status, 'revoked');
    await assert.rejects(
      () => collaborations.getSharedCase(active.id, invitee, meta),
      (error: AppError) => error.code === 'COLLABORATION_NOT_ACTIVE',
    );
    await assert.rejects(
      () => collaborations.createCollaborationMessage(active.id, invitee, 'After revocation.', meta),
      (error: AppError) => error.code === 'COLLABORATION_NOT_ACTIVE',
    );
  });

  it('serializes duplicate requests and concurrent acceptance/revocation', async () => {
    const facility = await makeFacility('Concurrency facility');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const invitee = await makeClinician(facility.facility.id, facility.department.id);
    const record = await makeCase(requester);
    await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);
    const input = {
      consultation_id: record.consultationId,
      invited_clinician_id: invitee.cpid,
      question: 'Synthetic concurrent request.',
    };

    const attempts = await Promise.allSettled([
      collaborations.requestCollaboration(requester, input, meta),
      collaborations.requestCollaboration(requester, input, meta),
    ]);
    const created = attempts.filter((result) => result.status === 'fulfilled');
    assert.equal(created.length, 1, 'only one request for a clinician pair and consultation may be active');
    const collaboration = (created[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof collaborations.requestCollaboration>>>).value;
    collaborationIds.push(collaboration.id);
    const rejected = attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal((rejected.reason as AppError).code, 'COLLABORATION_ALREADY_EXISTS');

    const [acceptResult, revokeResult] = await Promise.allSettled([
      collaborations.acceptCollaboration(collaboration.id, invitee, meta),
      collaborations.revokeCollaboration(collaboration.id, requester, meta),
    ]);
    assert.ok(acceptResult.status === 'fulfilled' || revokeResult.status === 'fulfilled');
    const final = await prisma.providerClinicalCollaboration.findUniqueOrThrow({ where: { id: collaboration.id } });
    assert.equal(final.status, 'revoked');
    await assert.rejects(() => collaborations.getSharedCase(collaboration.id, invitee, meta));
  });

  it('serializes a new request with patient consent revocation', async () => {
    const facility = await makeFacility('Consent race facility');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const invitee = await makeClinician(facility.facility.id, facility.department.id);
    const record = await makeCase(requester);
    const consent = await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);

    const [requestResult, revokeResult] = await Promise.allSettled([
      collaborations.requestCollaboration(requester, {
        consultation_id: record.consultationId,
        invited_clinician_id: invitee.cpid,
        question: 'Synthetic concurrent consent-revoke test.',
      }, meta),
      patientConsents.revokeConsent(record.patientId, consent.id, {
        sub: record.patientUserId, role: 'patient',
      }, meta),
    ]);
    assert.equal(revokeResult.status, 'fulfilled');

    if (requestResult.status === 'fulfilled') collaborationIds.push(requestResult.value.id);
    const rows = await prisma.providerClinicalCollaboration.findMany({ where: { patientConsentId: consent.id } });
    assert.ok(rows.every((row) => row.status === 'revoked'), 'a raced request must be absent or immediately revoked');
    assert.equal((await prisma.patientConsent.findUniqueOrThrow({ where: { id: consent.id } })).allowed, false);
  });

  it('persists expiry and stops access when consent expires or is revoked', async () => {
    const facility = await makeFacility('Expiry facility');
    const requester = await makeClinician(facility.facility.id, facility.department.id);
    const invitee = await makeClinician(facility.facility.id, facility.department.id);
    const record = await makeCase(requester);
    const consent = await grantThreadConsent(record.patientId, record.careThreadId, invitee.cpid);
    const accepted = await requestAndAccept(requester, invitee, record.consultationId);

    await prisma.providerClinicalCollaboration.update({
      where: { id: accepted.id }, data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await assert.rejects(() => collaborations.getSharedCase(accepted.id, invitee, meta));
    assert.equal((await prisma.providerClinicalCollaboration.findUniqueOrThrow({ where: { id: accepted.id } })).status, 'expired');

    const shortConsentInvitee = await makeClinician(facility.facility.id, facility.department.id);
    const shortConsent = await grantThreadConsent(
      record.patientId, record.careThreadId, shortConsentInvitee.cpid, new Date(Date.now() + 86_400_000),
    );
    const consentBound = await requestAndAccept(requester, shortConsentInvitee, record.consultationId);
    await prisma.patientConsent.update({ where: { id: shortConsent.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await assert.rejects(() => collaborations.getSharedCase(consentBound.id, shortConsentInvitee, meta));
    assert.equal((await prisma.providerClinicalCollaboration.findUniqueOrThrow({ where: { id: consentBound.id } })).status, 'expired');

    const second = await requestAndAccept(requester, invitee, record.consultationId);
    await patientConsents.revokeConsent(record.patientId, consent.id,
      { sub: record.patientUserId, role: 'patient' }, meta);
    await assert.rejects(() => collaborations.getSharedCase(second.id, invitee, meta));
    assert.equal((await prisma.providerClinicalCollaboration.findUniqueOrThrow({ where: { id: second.id } })).status, 'revoked');
  });
});
