import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as clinicians from '../services/clinician.service.js';
import * as slots from '../services/slot.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const createdUsers: string[] = [];
const adminId = randomUUID();

after(async () => {
  for (const id of createdUsers) {
    await prisma.slot.deleteMany({ where: { clinician: { userId: id } } }).catch(() => undefined);
    await prisma.clinicianProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeClinician(status: 'pending' | 'verified' = 'pending') {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: 'clinician',
      status: status === 'verified' ? 'active' : 'pending_verification',
      fullName: 'Test Clinician',
    },
  });
  createdUsers.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: 'general_practice',
      verificationStatus: status,
    },
  });
  return { user, profile };
}

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

describe('verification', () => {
  it('approving a licence also activates the account', async () => {
    const { user, profile } = await makeClinician('pending');
    const result = await clinicians.decideVerification(
      profile.id,
      adminId,
      'approve',
      undefined,
      meta,
    );

    assert.equal(result.verification_status, 'verified');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.status, 'active', 'approval is what makes the account usable');
  });

  it('rejecting records the reason and forces the clinician off duty', async () => {
    const { profile } = await makeClinician('verified');
    await prisma.clinicianProfile.update({
      where: { id: profile.id },
      data: { isAvailable: true },
    });

    const result = await clinicians.decideVerification(
      profile.id,
      adminId,
      'reject',
      'Licence could not be confirmed with the council',
      meta,
    );

    assert.equal(result.verification_status, 'rejected');
    assert.equal(result.is_available, false, 'a rejected licence must not stay on duty');
    assert.ok(result.rejection_reason);
  });

  it('refuses to approve twice', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () => clinicians.decideVerification(profile.id, adminId, 'approve', undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('availability', () => {
  it('refuses an unverified clinician', async () => {
    const { profile } = await makeClinician('pending');
    await assert.rejects(
      () => clinicians.setAvailability(profile.id, true, undefined, meta),
      (e: AppError) => e.code === 'CLINICIAN_NOT_VERIFIED',
    );
  });

  it('lets a verified clinician go on duty', async () => {
    const { profile } = await makeClinician('verified');
    const result = await clinicians.setAvailability(profile.id, true, undefined, meta);
    assert.equal(result.is_available, true);
  });
});

describe('slots', () => {
  it('publishes a clean set', async () => {
    const { profile } = await makeClinician('verified');
    const start = soon(60);
    const result = await slots.publishSlots(profile.id, {
      from: dayOf(start),
      to: dayOf(soon(1440)),
      slots: [
        { starts_at: start, duration_minutes: 30, modality: 'chat' },
        { starts_at: soon(120), duration_minutes: 30, modality: 'chat' },
      ],
    });
    assert.equal(result.published.length, 2);
  });

  it('rejects overlapping slots', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(60)),
          to: dayOf(soon(1440)),
          slots: [
            { starts_at: soon(60), duration_minutes: 30, modality: 'chat' },
            // Starts 15 minutes into the previous slot. Different start time,
            // same clinician, same moment — the unique constraint misses this.
            { starts_at: soon(75), duration_minutes: 30, modality: 'chat' },
          ],
        }),
      (e: AppError) => e.code === 'SLOT_UNAVAILABLE',
    );
  });

  it('rejects a slot in the past', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(-2880)),
          to: dayOf(soon(1440)),
          slots: [{ starts_at: soon(-60), duration_minutes: 30, modality: 'chat' }],
        }),
      (e: AppError) => e.code === 'SLOT_IN_PAST',
    );
  });

  it('keeps a booked slot when the calendar is republished', async () => {
    const { profile } = await makeClinician('verified');
    const bookedAt = new Date(Date.now() + 180 * 60_000);
    await prisma.slot.create({
      data: {
        clinicianId: profile.id,
        startsAt: bookedAt,
        durationMin: 30,
        modality: 'chat',
        isBooked: true,
      },
    });

    // Republishing an empty calendar must not silently cancel a patient's
    // appointment.
    const result = await slots.publishSlots(profile.id, {
      from: dayOf(bookedAt.toISOString()),
      to: dayOf(soon(2880)),
      slots: [],
    });

    assert.equal(result.retained.length, 1);
    assert.equal(result.retained[0]!.is_booked, true);
  });

  it('refuses an unverified clinician', async () => {
    const { profile } = await makeClinician('pending');
    await assert.rejects(
      () =>
        slots.publishSlots(profile.id, {
          from: dayOf(soon(60)),
          to: dayOf(soon(1440)),
          slots: [{ starts_at: soon(60), duration_minutes: 30, modality: 'chat' }],
        }),
      (e: AppError) => e.code === 'CLINICIAN_NOT_VERIFIED',
    );
  });
});
