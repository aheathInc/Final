import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { verifyAuditChain, type AppError } from '@a-health/http';
import * as referrals from '../services/referral.service.js';
import * as patientConsents from '../../../patient/src/services/consent.service.js';
import { listLedgerEvents, verifyLedger } from '../../../auth/src/services/ledger.service.js';

const testTarget = assertIsolatedLocalTestTarget(process.env);

before(async () => { await verifyLocalTestIdentity(prisma, testTarget); });

const meta = { ip: '127.0.0.1', requestId: 'digital-referral-test' };
const userIds: string[] = [];
const clinicianIds: string[] = [];
const facilityIds: string[] = [];
const departmentIds: string[] = [];
const profileIds: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const consentIds: string[] = [];
const referralIds: string[] = [];

after(async () => {
  await prisma.digitalReferral.deleteMany({ where: { id: { in: referralIds } } }).catch(() => undefined);
  await prisma.notificationLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await prisma.patientConsent.deleteMany({ where: { id: { in: consentIds } } }).catch(() => undefined);
  await prisma.consultationRequest.deleteMany({ where: { id: { in: consultationIds } } }).catch(() => undefined);
  await prisma.careThread.deleteMany({ where: { id: { in: threadIds } } }).catch(() => undefined);
  await prisma.patientProfile.deleteMany({ where: { id: { in: profileIds } } }).catch(() => undefined);
  await prisma.clinicianProfile.deleteMany({ where: { id: { in: clinicianIds } } }).catch(() => undefined);
  await prisma.department.deleteMany({ where: { id: { in: departmentIds } } }).catch(() => undefined);
  await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function makeFacility(label: string) {
  const facility = await prisma.facility.create({
    data: { name: `Synthetic referral ${label} ${randomUUID().slice(0, 8)}`, type: 'clinic' },
  });
  facilityIds.push(facility.id);
  const department = await prisma.department.create({
    data: { facilityId: facility.id, name: `Synthetic ${label} department`, specialty: 'general_practice' },
  });
  departmentIds.push(department.id);
  return { facility, department };
}

async function makeClinician(facilityId: string, departmentId: string, verified: boolean) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@digital-referral.test`,
      role: 'clinician', status: 'active', fullName: `Synthetic Referral Clinician ${randomUUID().slice(0, 4)}`,
    },
  });
  userIds.push(user.id);
  const clinician = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `REFERRAL-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus: verified ? 'verified' : 'pending',
      facilityId,
      departmentId,
    },
  });
  clinicianIds.push(clinician.id);
  return { sub: user.id, role: 'clinician', cpid: clinician.id };
}

async function makePatient(label: string) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: 'patient', status: 'active', fullName: `Synthetic Patient ${label}`,
    },
  });
  userIds.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: `Synthetic Patient ${label}` } });
  profileIds.push(profile.id);
  return { sub: user.id, role: 'patient', ppid: profile.id, profileId: profile.id };
}

async function makeCase(source: { cpid: string }, patient: Awaited<ReturnType<typeof makePatient>>) {
  const thread = await prisma.careThread.create({
    data: { patientProfileId: patient.profileId, primaryClinicianId: source.cpid, reasonSummary: 'Synthetic referral acceptance case' },
  });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id,
      patientProfileId: patient.profileId,
      assignedClinicianId: source.cpid,
      channel: 'web', modality: 'async',
      urgencyLevel: 'routine', triageRuleVersion: 'digital-referral-test',
      status: 'in_progress', symptomText: 'Synthetic test-only summary; no real clinical information.',
      structuredSymptoms: [{ code: 'SYNTHETIC' }],
      slaDeadlineAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  consultationIds.push(consultation.id);
  return { profileId: patient.profileId, threadId: thread.id, consultationId: consultation.id };
}

async function grantFacilityConsent(profileId: string, threadId: string, facilityId: string) {
  const consent = await prisma.patientConsent.create({
    data: {
      patientProfileId: profileId, careThreadId: threadId,
      granteeType: 'facility', granteeFacilityId: facilityId,
      scope: 'current_thread', allowed: true, breakGlass: false,
      reason: 'Synthetic exact-facility referral authorization.',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  consentIds.push(consent.id);
  return consent;
}

const createInput = (record: { consultationId: string }, destinationFacilityId: string, patientConsentId: string) => ({
  consultation_id: record.consultationId,
  destination_facility_id: destinationFacilityId,
  patient_consent_id: patientConsentId,
  purpose: 'Synthetic referral workflow verification.',
  clinical_summary: 'Synthetic summary provided only for local acceptance testing.',
  priority: 'routine' as const,
});

async function create(source: { sub: string; role: string; cpid: string }, record: { consultationId: string }, facilityId: string, consentId: string) {
  const referral = await referrals.createReferral(source, createInput(record, facilityId, consentId), meta);
  referralIds.push(referral.id);
  return referral;
}

describe('digital referral network', () => {
  it('enforces a cross-facility referral lifecycle, provenance, and patient isolation', async () => {
    const sourceFacility = await makeFacility('source');
    const destination = await makeFacility('destination');
    const unrelated = await makeFacility('unrelated');
    const source = await makeClinician(sourceFacility.facility.id, sourceFacility.department.id, true);
    const destinationA = await makeClinician(destination.facility.id, destination.department.id, true);
    const destinationB = await makeClinician(destination.facility.id, destination.department.id, true);
    const outsider = await makeClinician(unrelated.facility.id, unrelated.department.id, true);
    const pending = await makeClinician(destination.facility.id, destination.department.id, false);
    const patientA = await makePatient('A');
    const patientB = await makePatient('B');
    const record = await makeCase(source, patientA);
    const consent = await grantFacilityConsent(record.profileId, record.threadId, destination.facility.id);
    const input = createInput(record, destination.facility.id, consent.id);

    const listedCases = await referrals.listReferralCases(source);
    assert.ok(listedCases.data.some((item) => item.consultation_id === record.consultationId));
    const authorizations = await referrals.listReferralAuthorizations(record.consultationId, source);
    assert.ok(authorizations.data.some((item) => item.consent_id === consent.id));
    await assert.rejects(() => referrals.listReferralAuthorizations(record.consultationId, outsider),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(() => referrals.createReferral(outsider, input, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(() => referrals.createReferral(pending, input, meta),
      (error: AppError) => error.code === 'CLINICIAN_NOT_VERIFIED');
    await assert.rejects(() => referrals.createReferral(patientA, input, meta),
      (error: AppError) => error.code === 'ROLE_NOT_PERMITTED');

    const created = await create(source, record, destination.facility.id, consent.id);
    assert.equal(created.status, 'draft');
    await assert.rejects(() => referrals.createReferral(source, input, meta),
      (error: AppError) => error.code === 'REFERRAL_ALREADY_EXISTS');
    assert.deepEqual((await referrals.listInboxReferrals(destinationA)).data, []);
    await assert.rejects(() => referrals.acceptReferral(created.id, destinationA, meta),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID');
    await assert.rejects(() => referrals.getReferral(created.id, patientA),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');

    const submitted = await referrals.submitReferral(created.id, source, meta);
    assert.equal(submitted.status, 'submitted');
    const incoming = await referrals.listInboxReferrals(destinationA);
    assert.equal(incoming.data.find((row) => row.id === created.id)?.clinical_summary, input.clinical_summary);
    assert.deepEqual((await referrals.listInboxReferrals(outsider)).data, []);
    await assert.rejects(() => referrals.getReferral(created.id, outsider, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');
    const patientRead = await referrals.getReferral(created.id, patientA);
    assert.equal(patientRead.status, 'submitted');
    assert.equal(patientRead.destination.facility.id, destination.facility.id);
    await assert.rejects(() => referrals.getReferral(created.id, patientB, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(() => referrals.createReferral(source, {
      ...input, patient_consent_id: randomUUID(),
    }, meta), (error: AppError) => error.code === 'REFERRAL_CONSENT_REQUIRED');

    const received = await referrals.receiveReferral(created.id, destinationA, meta);
    assert.equal(received.status, 'received');
    assert.equal(received.received_by?.clinician_id, destinationA.cpid);
    const acceptance = await Promise.allSettled([
      referrals.acceptReferral(created.id, destinationA, meta),
      referrals.acceptReferral(created.id, destinationB, meta),
    ]);
    assert.equal(acceptance.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(acceptance.filter((item) => item.status === 'rejected').length, 1);
    const winnerIndex = acceptance.findIndex((item) => item.status === 'fulfilled');
    const winner = winnerIndex === 0 ? destinationA : destinationB;
    const accepted = await referrals.getReferral(created.id, winner);
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.accepted_at);
    assert.equal(accepted.care_started_at, null, 'acceptance must not claim care has begun');
    await assert.rejects(() => referrals.startReferralCare(created.id, source, meta),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID');

    const inCare = await referrals.startReferralCare(created.id, winner, meta);
    assert.equal(inCare.status, 'in_care');
    assert.ok(inCare.care_started_at);
    const completed = await referrals.completeReferral(created.id, winner, {
      outcome_status: 'care_provided',
      follow_up_recommendation: 'Synthetic follow-up entry for testing only.',
      patient_instructions: 'Synthetic patient instruction for testing only.',
    }, meta);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.outcome?.status, 'care_provided');
    assert.equal(completed.outcome?.receiving_clinician.clinician_id, winner.cpid);
    assert.ok(completed.completed_at);
    await assert.rejects(() => referrals.completeReferral(created.id, source, {
      outcome_status: 'care_provided',
    }, meta));

    const sourceRead = await referrals.getReferral(created.id, source);
    const patientFinalRead = await referrals.getReferral(created.id, patientA);
    assert.equal(sourceRead.outcome?.id, completed.outcome?.id);
    assert.equal(patientFinalRead.outcome?.id, completed.outcome?.id);
    assert.equal((await referrals.listPatientReferrals(patientA)).data[0]?.id, created.id);
    await assert.rejects(() => referrals.getReferral(created.id, patientB, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER');

    const ledger = await listLedgerEvents({ category: 'referral', limit: 100 });
    const referralEvents = ledger.data.filter((event) => event.resource_id === created.id);
    for (const action of [
      'referral.created', 'referral.submitted', 'referral.received', 'referral.accepted',
      'referral.care_started', 'referral.completed',
    ]) assert.ok(referralEvents.some((event) => event.event_type === action), `missing ${action}`);
    assert.ok(referralEvents.every((event) => !JSON.stringify(event.details).includes('Synthetic')));
    assert.equal((await verifyAuditChain()).ok, true);
    assert.equal((await verifyLedger()).status, 'VALID');
  });

  it('persists decline, cancellation, expiry and consent-revocation behavior', async () => {
    const sourceFacility = await makeFacility('lifecycle source');
    const destination = await makeFacility('lifecycle destination');
    const source = await makeClinician(sourceFacility.facility.id, sourceFacility.department.id, true);
    const receiver = await makeClinician(destination.facility.id, destination.department.id, true);
    const patient = await makePatient('lifecycle');

    const declinedCase = await makeCase(source, patient);
    const declinedConsent = await grantFacilityConsent(declinedCase.profileId, declinedCase.threadId, destination.facility.id);
    const declined = await create(source, declinedCase, destination.facility.id, declinedConsent.id);
    await referrals.submitReferral(declined.id, source, meta);
    await referrals.receiveReferral(declined.id, receiver, meta);
    const declinedResult = await referrals.declineReferral(declined.id, receiver, 'Synthetic capacity reason.', meta);
    assert.equal(declinedResult.status, 'declined');
    assert.equal(declinedResult.decline_reason, 'Synthetic capacity reason.');
    await assert.rejects(() => referrals.acceptReferral(declined.id, receiver, meta),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID');

    const cancelledCase = await makeCase(source, patient);
    const cancelledConsent = await grantFacilityConsent(cancelledCase.profileId, cancelledCase.threadId, destination.facility.id);
    const cancelled = await create(source, cancelledCase, destination.facility.id, cancelledConsent.id);
    const cancelledResult = await referrals.cancelReferral(cancelled.id, source, meta);
    assert.equal(cancelledResult.status, 'cancelled');
    await assert.rejects(() => referrals.acceptReferral(cancelled.id, receiver, meta),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID');

    const expiredCase = await makeCase(source, patient);
    const expiredConsent = await grantFacilityConsent(expiredCase.profileId, expiredCase.threadId, destination.facility.id);
    const expired = await create(source, expiredCase, destination.facility.id, expiredConsent.id);
    await referrals.submitReferral(expired.id, source, meta);
    await prisma.digitalReferral.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await referrals.getReferral(expired.id, patient)).status, 'expired');
    await assert.rejects(() => referrals.acceptReferral(expired.id, receiver, meta),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID');

    const revokedCase = await makeCase(source, patient);
    const revokedConsent = await grantFacilityConsent(revokedCase.profileId, revokedCase.threadId, destination.facility.id);
    const active = await create(source, revokedCase, destination.facility.id, revokedConsent.id);
    await referrals.submitReferral(active.id, source, meta);
    await patientConsents.revokeConsent(revokedCase.profileId, revokedConsent.id,
      { sub: patient.sub, role: 'patient', ppid: patient.ppid }, meta);
    assert.equal((await referrals.getReferral(active.id, patient)).status, 'cancelled');
    await assert.rejects(() => referrals.getReferralSummary(active.id, receiver, meta),
      (error: AppError) => error.code === 'NOT_RESOURCE_OWNER' || error.code === 'REFERRAL_CONSENT_REQUIRED');
    await assert.rejects(() => referrals.acceptReferral(active.id, receiver, meta),
      (error: AppError) => error.code === 'REFERRAL_CONSENT_REQUIRED' || error.code === 'STATE_TRANSITION_INVALID');
  });
});
