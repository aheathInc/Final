import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { acceptConsultation, declineConsultation, offerConsultation } from '../services/consultation.service.js';
import { getQueue } from '../services/queue.service.js';
import { tick } from '../workers/sla.worker.js';

const databaseUrl = process.env.DATABASE_URL ?? '';
let databaseName = '';
let parsedDatabaseUrl: URL | undefined;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
  databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.split('/').filter(Boolean)[0] ?? '');
} catch { /* rejected below */ }
if (
  databaseName !== 'ahealth_test' ||
  !parsedDatabaseUrl ||
  !['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname) ||
  (parsedDatabaseUrl.port || '5432') === '5432'
) {
  throw new Error('Refusing offer lifecycle DB tests unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
}

type Fixture = { patientUserId: string; patientProfileId: string; clinicianUserId: string; clinicianId: string; threadId: string; consultationId: string };
const fixtures: Fixture[] = [];
const extraClinicianUserIds: string[] = [];
const extraClinicianIds: string[] = [];
let marketplaceProfiles: Array<{ id: string; isAvailable: boolean }> = [];
before(async () => {
  // The shared test database may also contain the persistent synthetic
  // marketplace clinicians used by the Staff Web acceptance fixture. Keep
  // them out of these routing assertions and restore their original state.
  marketplaceProfiles = await prisma.clinicianProfile.findMany({
    where: { user: { email: { in: ['marketplace.doctor.a@dev.local', 'marketplace.doctor.b@dev.local'] } } },
    select: { id: true, isAvailable: true },
  });
  await prisma.clinicianProfile.updateMany({
    where: { id: { in: marketplaceProfiles.map((profile) => profile.id) } },
    data: { isAvailable: false },
  });
});
beforeEach(async () => {
  const previousClinicianIds = [...fixtures.map((fixture) => fixture.clinicianId), ...extraClinicianIds];
  if (previousClinicianIds.length > 0) {
    await prisma.clinicianProfile.updateMany({
      where: { id: { in: previousClinicianIds } },
      data: { isAvailable: false },
    });
  }
});

after(async () => {
  const consultationIds = fixtures.map((f) => f.consultationId);
  const threadIds = fixtures.map((f) => f.threadId);
  const profileIds = fixtures.map((f) => f.patientProfileId);
  const userIds = [...fixtures.flatMap((f) => [f.patientUserId, f.clinicianUserId]), ...extraClinicianUserIds];
  try {
    await prisma.consultationOffer.deleteMany({ where: { consultationId: { in: consultationIds } } });
    await prisma.consultationRequest.deleteMany({ where: { id: { in: consultationIds } } });
    await prisma.careThread.deleteMany({ where: { id: { in: threadIds } } });
    await prisma.patientProfile.deleteMany({ where: { id: { in: profileIds } } });
    await prisma.clinicianProfile.deleteMany({ where: { id: { in: [...fixtures.map((f) => f.clinicianId), ...extraClinicianIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await Promise.all(marketplaceProfiles.map((profile) =>
      prisma.clinicianProfile.update({ where: { id: profile.id }, data: { isAvailable: profile.isAvailable } }),
    ));
    await prisma.$disconnect();
  }
});

async function makeFixture(options: { available?: boolean; status?: 'pending' | 'offered'; deadline?: Date } = {}) {
  const suffix = randomUUID();
  const patient = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Offer lifecycle test patient' },
  });
  const patientProfile = await prisma.patientProfile.create({ data: { userId: patient.id, fullName: 'Offer lifecycle test patient' } });
  const clinicianUser = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${suffix}@offer.test`, role: 'clinician', status: 'active', fullName: 'Offer lifecycle test clinician' },
  });
  const clinician = await prisma.clinicianProfile.create({
    data: {
      userId: clinicianUser.id, licenseNumber: `OFFER-${suffix.slice(0, 12)}`,
      specialty: 'general_practice', verificationStatus: 'verified', isAvailable: options.available ?? true,
    },
  });
  const thread = await prisma.careThread.create({ data: { patientProfileId: patientProfile.id } });
  const consultation = await prisma.consultationRequest.create({
    data: {
      careThreadId: thread.id, patientProfileId: patientProfile.id, channel: 'app', modality: 'chat',
      urgencyLevel: 'routine', triageRuleVersion: 'offer-lifecycle-test', status: options.status ?? 'pending',
      slaDeadlineAt: options.deadline ?? new Date(Date.now() + 60 * 60_000),
    },
  });
  const fixture = {
    patientUserId: patient.id, patientProfileId: patientProfile.id, clinicianUserId: clinicianUser.id,
    clinicianId: clinician.id, threadId: thread.id, consultationId: consultation.id,
  };
  fixtures.push(fixture);
  return { ...fixture, clinicianCaller: { sub: clinicianUser.id, role: 'clinician', cpid: clinician.id } };
}

async function queueFor(f: Awaited<ReturnType<typeof makeFixture>>) {
  return getQueue(f.clinicianCaller, { scope: 'offered', limit: 50 }) as Promise<{
    data: Array<{ consultation: { id: string }; offer?: { state: string; expires_at: string } }>;
  }>;
}

describe('consultation offer expiry lifecycle', () => {
  it('reactivates the expired pair and puts the same consultation back in the clinician queue', async () => {
    const f = await makeFixture();
    assert.equal(await offerConsultation(f.consultationId, f.clinicianId), 1);
    const before = await prisma.consultationOffer.findUniqueOrThrow({
      where: { consultationId_clinicianId: { consultationId: f.consultationId, clinicianId: f.clinicianId } },
    });
    const expiredAt = new Date(Date.now() - 1000);
    await prisma.consultationOffer.update({
      where: { id: before.id }, data: { status: 'expired', expiresAt: expiredAt, respondedAt: expiredAt },
    });

    assert.equal(await offerConsultation(f.consultationId, f.clinicianId), 1);
    const after = await prisma.consultationOffer.findUniqueOrThrow({
      where: { consultationId_clinicianId: { consultationId: f.consultationId, clinicianId: f.clinicianId } },
    });
    assert.equal(after.id, before.id);
    assert.equal(after.status, 'offered');
    assert.ok(after.expiresAt > new Date());
    assert.equal(after.respondedAt?.getTime(), expiredAt.getTime());
    assert.ok(after.version > before.version);
    const queued = (await queueFor(f)).data.find((row) => row.consultation.id === f.consultationId);
    assert.ok(queued);
    assert.equal(queued.offer?.state, 'offered');
    assert.equal(Date.parse(queued.offer?.expires_at ?? ''), after.expiresAt.getTime());
  });

  it('keeps repeated and concurrent routing idempotent for one consultation/clinician pair', async () => {
    const f = await makeFixture();
    await Promise.all([
      offerConsultation(f.consultationId, f.clinicianId),
      offerConsultation(f.consultationId, f.clinicianId),
      offerConsultation(f.consultationId, f.clinicianId),
    ]);
    const rows = await prisma.consultationOffer.findMany({ where: { consultationId: f.consultationId, clinicianId: f.clinicianId } });
    const actionable = rows.filter((row) => row.status === 'offered' && row.expiresAt > new Date());
    assert.equal(rows.length, 1);
    assert.equal(actionable.length, 1);
  });

  it('keeps a refreshed pair and other clinicians’ active offers independently actionable', async () => {
    const f = await makeFixture();
    const otherUser = await prisma.user.create({
      data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@offer.test`, role: 'clinician', status: 'active', fullName: 'Second offer lifecycle clinician' },
    });
    extraClinicianUserIds.push(otherUser.id);
    const otherClinician = await prisma.clinicianProfile.create({
      data: { userId: otherUser.id, licenseNumber: `OFFER-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified', isAvailable: true },
    });
    extraClinicianIds.push(otherClinician.id);
    await offerConsultation(f.consultationId);
    await prisma.consultationOffer.updateMany({
      where: { consultationId: f.consultationId, clinicianId: f.clinicianId },
      data: { status: 'expired', expiresAt: new Date(Date.now() - 1000), respondedAt: new Date(Date.now() - 1000) },
    });
    assert.ok(await offerConsultation(f.consultationId));
    const actionable = await prisma.consultationOffer.findMany({
      where: { consultationId: f.consultationId, status: 'offered', expiresAt: { gt: new Date() } },
    });
    assert.equal(actionable.length, 2);
    assert.deepEqual(new Set(actionable.map((row) => row.clinicianId)), new Set([f.clinicianId, otherClinician.id]));
  });

  it('hides expired offers and returns the consultation to waiting when no offer remains', async () => {
    const f = await makeFixture();
    await offerConsultation(f.consultationId, f.clinicianId);
    await prisma.consultationOffer.updateMany({
      where: { consultationId: f.consultationId }, data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await tick();
    assert.equal((await queueFor(f)).data.some((row) => row.consultation.id === f.consultationId), false);
    const consultation = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: f.consultationId } });
    assert.equal(consultation.status, 'pending');
  });

  it('rejects acceptance of an expired offer until routing legitimately refreshes it', async () => {
    const f = await makeFixture();
    await offerConsultation(f.consultationId, f.clinicianId);
    await prisma.consultationOffer.updateMany({
      where: { consultationId: f.consultationId }, data: { status: 'expired', expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(
      () => acceptConsultation(f.consultationId, f.clinicianCaller, {}),
      (error: AppError) => error.code === 'STATE_TRANSITION_INVALID',
    );
    assert.equal(await offerConsultation(f.consultationId, f.clinicianId), 1);
    assert.equal((await prisma.consultationOffer.findFirstOrThrow({ where: { consultationId: f.consultationId } })).status, 'offered');
  });

  it('keeps decline terminal for that clinician while allowing normal routing fallback', async () => {
    const f = await makeFixture();
    await offerConsultation(f.consultationId, f.clinicianId);
    await declineConsultation(f.consultationId, f.clinicianCaller, 'other', {});
    const offer = await prisma.consultationOffer.findUniqueOrThrow({
      where: { consultationId_clinicianId: { consultationId: f.consultationId, clinicianId: f.clinicianId } },
    });
    assert.equal(offer.status, 'declined');
    assert.equal(await offerConsultation(f.consultationId, f.clinicianId), 0);
    assert.equal((await prisma.consultationOffer.count({ where: { consultationId: f.consultationId, clinicianId: f.clinicianId, status: 'offered' } })), 0);
    assert.equal((await prisma.consultationRequest.findUniqueOrThrow({ where: { id: f.consultationId } })).status, 'pending');
  });

  it('serializes re-offer against accept and leaves either a matched request or one actionable offer', async () => {
    const f = await makeFixture();
    await offerConsultation(f.consultationId, f.clinicianId);
    await prisma.consultationOffer.updateMany({
      where: { consultationId: f.consultationId }, data: { status: 'expired', expiresAt: new Date(Date.now() - 1000) },
    });
    const results = await Promise.allSettled([
      offerConsultation(f.consultationId, f.clinicianId),
      acceptConsultation(f.consultationId, f.clinicianCaller, {}),
    ]);
    const consultation = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: f.consultationId } });
    const activeCount = await prisma.consultationOffer.count({
      where: { consultationId: f.consultationId, status: 'offered', expiresAt: { gt: new Date() } },
    });
    if (consultation.status === 'matched') {
      assert.equal(consultation.assignedClinicianId, f.clinicianId);
      assert.equal(activeCount, 0);
      assert.ok(results.some((result) => result.status === 'fulfilled'));
    } else {
      assert.equal(consultation.status, 'offered');
      assert.equal(activeCount, 1);
    }
  });

  it('allows only one of two concurrent SLA ticks to escalate and re-route the same request', async () => {
    const f = await makeFixture({ deadline: new Date(Date.now() - 1000) });
    await offerConsultation(f.consultationId, f.clinicianId);
    await prisma.consultationOffer.updateMany({
      where: { consultationId: f.consultationId }, data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await Promise.all([tick(), tick()]);
    const consultation = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: f.consultationId } });
    const offers = await prisma.consultationOffer.findMany({ where: { consultationId: f.consultationId, clinicianId: f.clinicianId } });
    const activeCount = offers.filter((row) => row.status === 'offered' && row.expiresAt > new Date()).length;
    assert.equal(consultation.escalationCount, 1);
    assert.equal(consultation.status, 'offered');
    assert.equal(activeCount, 1);
    assert.equal(offers.length, 1);
  });

  it('does not leave status offered when no clinician is eligible', async () => {
    const f = await makeFixture({ available: false, status: 'offered' });
    assert.equal(await offerConsultation(f.consultationId), 0);
    const consultation = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: f.consultationId } });
    assert.equal(consultation.status, 'pending');
    assert.equal(await prisma.consultationOffer.count({ where: { consultationId: f.consultationId, status: 'offered', expiresAt: { gt: new Date() } } }), 0);
  });
});
