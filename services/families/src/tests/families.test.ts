import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as families from '../services/family.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const familyIds: string[] = [];

after(async () => {
  for (const id of familyIds) {
    await prisma.familyAssignment.deleteMany({ where: { familyId: id } }).catch(() => undefined);
    await prisma.familyMember.deleteMany({ where: { familyId: id } }).catch(() => undefined);
    await prisma.family.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Family Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Family Test' } });
  return { user, profile };
}

async function makeClinician(maxFamilyLoad = 10) {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Family Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified', maxFamilyLoad },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('creating and viewing', () => {
  it('creates a family with the caller as head, and getMyFamily finds it', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'The Test Family' }, meta);
    familyIds.push(family.id);

    const mine = await families.getMyFamily({ sub: user.id, role: 'patient' });
    assert.equal(mine.id, family.id);
    assert.equal(mine.members.length, 0);
  });

  it('refuses a caller with no family', async () => {
    await assert.rejects(
      () => families.getMyFamily({ sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_FOUND',
    );
  });
});

describe('membership', () => {
  it('lets the head add a member', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Add Member Family' }, meta);
    familyIds.push(family.id);
    const { profile: childProfile } = await makePatient();

    const member = await families.addFamilyMember(
      family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: childProfile.id, relationship: 'child' }, meta,
    );
    assert.equal(member.relationship, 'child');

    const mine = await families.getMyFamily({ sub: user.id, role: 'patient' });
    assert.equal(mine.members.length, 1);
  });

  it('refuses a non-head adding a member', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'No Access Family' }, meta);
    familyIds.push(family.id);
    const { profile: other } = await makePatient();

    await assert.rejects(
      () => families.addFamilyMember(family.id, { sub: randomUUID(), role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses adding the same patient twice', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Dup Family' }, meta);
    familyIds.push(family.id);
    const { profile: other } = await makePatient();
    await families.addFamilyMember(family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta);

    await assert.rejects(
      () => families.addFamilyMember(family.id, { sub: user.id, role: 'patient' }, { patient_profile_id: other.id, relationship: 'spouse' }, meta),
      (e: AppError) => e.code === 'DUPLICATE_RESOURCE',
    );
  });
});

describe('doctor assignment', () => {
  it('assigns a separate GP and OB/GYN', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Assigned Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician();
    const obgyn = await makeClinician();

    const result = await families.assignFamilyDoctors(
      family.id, { sub: randomUUID(), role: 'platform_admin' },
      { gp_clinician_id: gp.id, obgyn_clinician_id: obgyn.id }, meta,
    );
    assert.equal(result.gp_clinician!.id, gp.id);
    assert.equal(result.obgyn_clinician!.id, obgyn.id);
    assert.notEqual(result.gp_clinician!.id, result.obgyn_clinician!.id);

    const reloadedGp = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: gp.id } });
    assert.equal(reloadedGp.familyLoad, 1);
  });

  it('refuses a non-admin assigning doctors', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Blocked Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician();

    await assert.rejects(
      () => families.assignFamilyDoctors(family.id, { sub: user.id, role: 'patient' }, { gp_clinician_id: gp.id }, meta),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses assigning a clinician at family-load capacity', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Full Panel Family' }, meta);
    familyIds.push(family.id);
    const gp = await makeClinician(1);

    const other = await makePatient();
    const otherFamily = await families.createFamily({ sub: other.user.id, role: 'patient' }, { name: 'Other Family' }, meta);
    familyIds.push(otherFamily.id);
    await families.assignFamilyDoctors(otherFamily.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: gp.id }, meta);

    await assert.rejects(
      () => families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: gp.id }, meta),
      (e: AppError) => e.code === 'CLINICIAN_UNAVAILABLE',
    );
  });

  it('releases the previous clinician\u2019s load on reassignment', async () => {
    const { user } = await makePatient();
    const family = await families.createFamily({ sub: user.id, role: 'patient' }, { name: 'Reassign Family' }, meta);
    familyIds.push(family.id);
    const firstGp = await makeClinician();
    const secondGp = await makeClinician();

    await families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: firstGp.id }, meta);
    await families.assignFamilyDoctors(family.id, { sub: randomUUID(), role: 'platform_admin' }, { gp_clinician_id: secondGp.id }, meta);

    const reloadedFirst = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: firstGp.id } });
    const reloadedSecond = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: secondGp.id } });
    assert.equal(reloadedFirst.familyLoad, 0);
    assert.equal(reloadedSecond.familyLoad, 1);
  });
});
