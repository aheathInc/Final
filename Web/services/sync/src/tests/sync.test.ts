import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { getSyncChanges } from '../services/changes.service.js';
import { applyBatch } from '../services/batch.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const users: string[] = [];
const threadIds: string[] = [];
const changeLogSeqs: bigint[] = [];

after(async () => {
  for (const seq of changeLogSeqs) {
    await prisma.changeLog.delete({ where: { seq } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Sync Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Sync Test' } });
  return { user, profile };
}

async function logChange(entity: string, entityId: string, op: 'create' | 'update' | 'delete', patientProfileId: string, version = 1) {
  const row = await prisma.changeLog.create({
    data: { entity, entityId, op: op as never, version, patientProfileId },
  });
  changeLogSeqs.push(row.seq);
  return row;
}

describe('reading changes', () => {
  it('returns a live snapshot for a create, scoped to the caller', async () => {
    const { profile } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, reasonSummary: 'test' } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', profile.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const change = result.data.find((c) => (c as { id: string }).id === thread.id);
    assert.ok(change);
    assert.equal((change as { op: string }).op, 'create');
    assert.ok('data' in change!);
  });

  it('emits a tombstone with no data for a delete', async () => {
    const { profile } = await makePatient();
    const fakeId = randomUUID();
    await logChange('care_threads', fakeId, 'delete', profile.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const change = result.data.find((c) => (c as { id: string }).id === fakeId);
    assert.ok(change);
    assert.equal((change as { op: string }).op, 'delete');
    assert.ok(!('data' in change!));
  });

  it('never returns another patient\u2019s changes', async () => {
    const { profile: mine } = await makePatient();
    const { profile: theirs } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: theirs.id } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', theirs.id);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: mine.id }, { limit: 50 });
    assert.ok(!result.data.some((c) => (c as { id: string }).id === thread.id));
  });

  it('collapses multiple changes to the same entity into one, keeping the latest', async () => {
    const { profile } = await makePatient();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
    threadIds.push(thread.id);
    await logChange('care_threads', thread.id, 'create', profile.id, 1);
    await logChange('care_threads', thread.id, 'update', profile.id, 2);

    const result = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 50 });
    const matches = result.data.filter((c) => (c as { id: string }).id === thread.id);
    assert.equal(matches.length, 1);
    assert.equal((matches[0] as { op: string }).op, 'update');
  });

  it('paginates with a cursor that advances on the next call', async () => {
    const { profile } = await makePatient();
    for (let i = 0; i < 3; i += 1) {
      const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
      threadIds.push(thread.id);
      await logChange('care_threads', thread.id, 'create', profile.id);
    }

    const first = await getSyncChanges({ sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 2 });
    assert.equal(first.data.length, 2);
    assert.equal(first.meta.has_more, true);

    const second = await getSyncChanges(
      { sub: randomUUID(), role: 'patient', ppid: profile.id }, { limit: 2, cursor: first.meta.next_cursor },
    );
    assert.ok(second.data.length >= 1);
  });
});

describe('applying a batch', () => {
  it('refuses a path that is not on the allow-list', async () => {
    const results = await applyBatch(
      [{ op_id: randomUUID(), method: 'POST', path: '/users/me/delete-everything' }],
      'Bearer fake-token',
    );
    assert.equal(results[0]!.status, 422);
    assert.equal(results[0]!.error?.code, 'VALIDATION_FAILED');
  });

  it('reports a per-operation result for each entry, even when the service is unreachable', async () => {
    const results = await applyBatch(
      [
        { op_id: randomUUID(), method: 'POST', path: '/appointments/{appointment_id}/cancel', path_params: { appointment_id: randomUUID() } },
        { op_id: randomUUID(), method: 'POST', path: '/consultations' },
      ],
      'Bearer fake-token',
    );
    assert.equal(results.length, 2);
    for (const r of results) assert.ok(typeof r.status === 'number');
  });

  it('fails one operation without blocking the next', async () => {
    const results = await applyBatch(
      [
        { op_id: randomUUID(), method: 'POST', path: '/not-a-real-path' },
        { op_id: randomUUID(), method: 'POST', path: '/consultations' },
      ],
      'Bearer fake-token',
    );
    assert.equal(results[0]!.status, 422);
    assert.ok(results[1]); // second entry still processed independently
  });
});
