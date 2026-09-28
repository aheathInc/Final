import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { seedProgrammes } from '../services/seedProgrammes.js';
import * as risk from '../services/riskScore.service.js';
import * as vaccinations from '../services/vaccination.service.js';
import * as screening from '../services/screening.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const programmeIds: string[] = [];
const invitationIds: string[] = [];

after(async () => {
  for (const id of invitationIds) {
    await prisma.screeningInvitation.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of programmeIds) {
    await prisma.screeningProgramme.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.riskScore.deleteMany({ where: { patient: { userId: id } } }).catch(() => undefined);
    await prisma.vaccination.deleteMany({ where: { patient: { userId: id } } }).catch(() => undefined);
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient(dob?: Date) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Prevention Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: 'Prevention Test', dateOfBirth: dob },
  });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Prevention Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('risk scoring', () => {
  it('computes a real, deterministic score with visible contributing factors', async () => {
    const { user, profile } = await makePatient(new Date('1970-01-01'));
    const result = await risk.computeRiskScores(profile.id, { sub: user.id, role: 'patient', ppid: profile.id }, ['hypertension']);
    assert.equal(result.data.length, 1);
    assert.ok(result.data[0]!.contributing_factors);
    assert.equal(result.data[0]!.model_version, 'rule-based-v1');
  });

  it('silently skips an unsupported condition rather than fabricating a score', async () => {
    const { user, profile } = await makePatient();
    const result = await risk.computeRiskScores(profile.id, { sub: user.id, role: 'patient', ppid: profile.id }, ['made_up_condition']);
    assert.equal(result.data.length, 0);
  });

  it('refuses a stranger viewing scores', async () => {
    const { profile } = await makePatient();
    await assert.rejects(
      () => risk.listRiskScores(profile.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});

describe('vaccinations', () => {
  it('lets a clinician record a dose', async () => {
    const { profile } = await makePatient();
    const clinician = await makeClinician();
    const dose = await vaccinations.recordVaccination(
      profile.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { vaccine_code: 'BCG', administered_at: new Date().toISOString() }, meta,
    );
    assert.equal(dose.status, 'administered');
  });

  it('refuses a patient recording their own dose', async () => {
    const { user, profile } = await makePatient();
    await assert.rejects(
      () => vaccinations.recordVaccination(
        profile.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { vaccine_code: 'BCG', administered_at: new Date().toISOString() }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('screening', () => {
  it('seeds the programme catalogue idempotently', async () => {
    const first = await seedProgrammes();
    const second = await seedProgrammes();
    programmeIds.push(...[]); // seeded rows are shared fixtures, not cleaned per-test
    assert.equal(second.inserted, 0);
    assert.ok(first.inserted + second.skipped >= 1);
  });

  it('requires a reason to decline', async () => {
    const { user, profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { response: 'decline' }, 'Bearer fake', meta,
      ),
    );
  });

  it('records a decline reason and refuses a second response', async () => {
    const { user, profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    const result = await screening.respondToInvitation(
      invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
      { response: 'decline', decline_reason: 'Too far to travel' }, 'Bearer fake', meta,
    );
    assert.equal(result.status, 'declined');
    assert.equal(result.decline_reason, 'Too far to travel');

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: user.id, role: 'patient', ppid: profile.id },
        { response: 'accept' }, 'Bearer fake', meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses a stranger responding to someone else\u2019s invitation', async () => {
    const { profile } = await makePatient();
    const programme = (await prisma.screeningProgramme.findFirst())!;
    const invitation = await prisma.screeningInvitation.create({
      data: { programmeId: programme.id, patientProfileId: profile.id },
    });
    invitationIds.push(invitation.id);

    await assert.rejects(
      () => screening.respondToInvitation(
        invitation.id, { sub: randomUUID(), role: 'patient' },
        { response: 'defer' }, 'Bearer fake', meta,
      ),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
