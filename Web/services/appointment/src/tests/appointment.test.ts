import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as appointments from '../services/appointment.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const slotIds: string[] = [];
const appointmentIds: string[] = [];
const threadIds: string[] = [];

after(async () => {
  for (const id of appointmentIds) {
    await prisma.consultationRequest.deleteMany({ where: { appointmentId: id } }).catch(() => undefined);
    await prisma.appointment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of slotIds) {
    await prisma.slot.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Appt Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Appt Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Appt Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeSlot(clinicianId: string, minutesFromNow: number) {
  const slot = await prisma.slot.create({
    data: { clinicianId, startsAt: new Date(Date.now() + minutesFromNow * 60_000), durationMin: 30, modality: 'chat' },
  });
  slotIds.push(slot.id);
  return slot;
}

describe('booking', () => {
  it('books a future slot and marks it unavailable', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);

    const result = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id },
      { slot_id: slot.id }, meta,
    );
    appointmentIds.push(result.id);
    assert.equal(result.status, 'booked');

    const reloaded = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloaded.isBooked, true);
  });

  it('refuses a slot that is already booked', async () => {
    const { user: u1, profile: p1 } = await makePatient();
    const { user: u2, profile: p2 } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 180);

    const first = await appointments.createAppointment({ sub: u1.id, role: 'patient', ppid: p1.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(first.id);

    await assert.rejects(
      () => appointments.createAppointment({ sub: u2.id, role: 'patient', ppid: p2.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_UNAVAILABLE',
    );
  });

  it('refuses a slot in the past', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, -30);

    await assert.rejects(
      () => appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_IN_PAST',
    );
  });
});

describe('starting', () => {
  it('refuses to start more than the window ahead of the slot', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_NOT_YET_STARTABLE',
    );
  });

  it('opens a matched consultation with no triage, inside the window', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const consultation = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(consultation.care_thread_id);

    assert.equal(consultation.status, 'matched');
    assert.equal(consultation.assigned_clinician_id, clinician.id);
    assert.equal(consultation.appointment_id, booked.id);

    const reloadedAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    assert.equal(reloadedAppt.status, 'started');
  });

  it('refuses to start an appointment twice', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const first = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(first.care_thread_id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_ALREADY_STARTED',
    );
  });

  it('reopens a closed care thread rather than orphaning the new consultation', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, status: 'closed', closedAt: new Date() } });
    threadIds.push(thread.id);
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id, care_thread_id: thread.id }, meta,
    );
    appointmentIds.push(booked.id);

    await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);

    const reloadedThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(reloadedThread.status, 'open');
  });
});

describe('cancelling', () => {
  it('releases the slot on cancel', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const cancelled = await appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, 'changed my mind', meta);
    assert.equal(cancelled.status, 'cancelled');

    const reloadedSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloadedSlot.isBooked, false);
  });

  it('refuses to cancel an already-started appointment', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const started = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(started.care_thread_id);

    await assert.rejects(
      () => appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('visibility', () => {
  it('refuses a stranger', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lets the assigned clinician see it', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const result = await appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id });
    assert.equal(result.id, booked.id);
  });
});
