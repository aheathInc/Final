import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import * as clinicians from '../services/clinician.service.js';
import * as slots from '../services/slot.service.js';

const testDatabaseUrl = process.env.DATABASE_URL ?? '';
let testDatabase: URL;
try {
  testDatabase = new URL(testDatabaseUrl);
} catch {
  throw new Error('Refusing clinician tests without a valid local ahealth_test DATABASE_URL.');
}
const testDatabaseName = decodeURIComponent(testDatabase.pathname.replace(/^\//, ''));
if (
  testDatabaseName !== 'ahealth_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(testDatabase.hostname) ||
  (testDatabase.port || '5432') === '5432'
) {
  throw new Error('Refusing clinician tests unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
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
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'clinician.verified', entityId: profile.id },
    });
    assert.equal(audit.actorUserId, adminId);
    assert.deepEqual(audit.metadata, { verificationStatus: 'verified' });
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
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'clinician.rejected', entityId: profile.id },
    });
    assert.equal(audit.actorUserId, adminId);
    assert.deepEqual(audit.metadata, { verificationStatus: 'rejected' });
    assert.equal(audit.reason, null, 'free-text rejection details stay outside the ledger');
  });

  it('refuses to approve twice', async () => {
    const { profile } = await makeClinician('verified');
    await assert.rejects(
      () => clinicians.decideVerification(profile.id, adminId, 'approve', undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('provider profile ownership', () => {
  it('lets a clinician read their own profile and denies another clinician', async () => {
    const first = await makeClinician('verified');
    const second = await makeClinician('verified');

    const own = await clinicians.getClinician(first.profile.id, {
      sub: first.user.id,
      role: 'clinician',
    });
    assert.equal(own.id, first.profile.id);
    assert.equal(own.user_id, first.user.id);
    assert.equal(own.verification_status, 'verified');
    assert.equal('password_hash' in own, false);

    await assert.rejects(
      () => clinicians.getClinician(first.profile.id, { sub: second.user.id, role: 'clinician' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('keeps pending license data in the platform-admin directory only', async () => {
    const pending = await makeClinician('pending');
    const query = { limit: 100 };
    const adminList = await clinicians.listClinicians(query, { role: 'platform_admin' });
    const adminEntry = adminList.data.find((entry) => entry.id === pending.profile.id);
    assert.equal(adminEntry?.verification_status, 'pending');
    assert.equal(adminEntry?.license_number, pending.profile.licenseNumber);

    const publicList = await clinicians.listClinicians(query, { role: 'patient' });
    assert.equal(publicList.data.some((entry) => entry.id === pending.profile.id), false);
    assert.equal(publicList.data.some((entry) => 'license_number' in entry), false);
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
