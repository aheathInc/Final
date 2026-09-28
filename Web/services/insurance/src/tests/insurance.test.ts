import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as insurance from '../services/insurance.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const schemeIds: string[] = [];
const threadIds: string[] = [];
const consultationIds: string[] = [];
const claimIds: string[] = [];

after(async () => {
  for (const id of claimIds) {
    await prisma.insuranceClaim.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.consultationRequest.deleteMany({ where: { careThreadId: id } }).catch(() => undefined);
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of schemeIds) {
    await prisma.insuranceMembership.deleteMany({ where: { schemeId: id } }).catch(() => undefined);
    await prisma.insuranceScheme.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Ins Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Ins Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Ins Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeScheme() {
  const scheme = await prisma.insuranceScheme.create({ data: { name: `Scheme ${randomUUID().slice(0, 8)}`, code: `S${randomUUID().slice(0, 6)}` } });
  schemeIds.push(scheme.id);
  return scheme;
}

async function makeConsultation(patientProfileId: string, clinicianId: string) {
  const thread = await prisma.careThread.create({ data: { patientProfileId } });
  threadIds.push(thread.id);
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId, assignedClinicianId: clinicianId,
      channel: 'app', modality: 'chat', urgencyLevel: 'routine', triageRuleVersion: 'test',
      status: 'completed', slaDeadlineAt: new Date(Date.now() + 3_600_000),
    },
  });
  consultationIds.push(consultation.id);
  return consultation;
}

describe('coverage', () => {
  it('lists an active membership', async () => {
    const { user, profile } = await makePatient();
    const scheme = await makeScheme();
    await prisma.insuranceMembership.create({
      data: { schemeId: scheme.id, patientProfileId: profile.id, membershipNumber: 'M-1', status: 'active' },
    });

    const result = await insurance.getCoverage({ sub: user.id, role: 'patient' }, profile.id);
    assert.equal(result.schemes.length, 1);
    assert.equal(result.schemes[0]!.status, 'active');
  });

  it('refuses a stranger checking someone else\u2019s coverage', async () => {
    const { profile } = await makePatient();
    await assert.rejects(
      () => insurance.getCoverage({ sub: randomUUID(), role: 'patient' }, profile.id),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('claims', () => {
  it('submits a claim for an active member', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const scheme = await makeScheme();
    await prisma.insuranceMembership.create({
      data: { schemeId: scheme.id, patientProfileId: profile.id, membershipNumber: 'M-2', status: 'active' },
    });
    const consultation = await makeConsultation(profile.id, clinician.id);

    const claim = await insurance.submitClaim(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
    );
    claimIds.push(claim.id);
    assert.equal(claim.status, 'submitted');
  });

  it('refuses a claim with no active membership', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const scheme = await makeScheme();
    const consultation = await makeConsultation(profile.id, clinician.id);

    await assert.rejects(
      () => insurance.submitClaim(
        { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
        { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses a clinician submitting for a consultation that is not theirs', async () => {
    const { profile } = await makePatient();
    const owner = await makeClinician();
    const stranger = await makeClinician();
    const scheme = await makeScheme();
    const consultation = await makeConsultation(profile.id, owner.id);

    await assert.rejects(
      () => insurance.submitClaim(
        { sub: randomUUID(), role: 'clinician', cpid: stranger.id },
        { consultation_id: consultation.id, scheme_id: scheme.id }, meta,
      ),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
