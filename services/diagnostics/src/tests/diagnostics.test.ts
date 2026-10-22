import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { computeFlag, isCriticalFlag } from '../engine/resultFlag.js';
import * as investigations from '../services/investigation.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const threadIds: string[] = [];
const orderIds: string[] = [];

after(async () => {
  for (const id of orderIds) {
    await prisma.investigationValue.deleteMany({ where: { orderId: id } }).catch(() => undefined);
    await prisma.investigationOrder.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
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
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Dx Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Dx Test' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id } });
  threadIds.push(thread.id);
  return { user, profile, thread };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Dx Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

describe('result flag engine', () => {
  it('flags a value inside all bounds as normal', () => {
    assert.equal(computeFlag({ value: '4.2', referenceLow: 3.5, referenceHigh: 5.0 }), 'normal');
  });

  it('flags high before critical when only high is breached', () => {
    assert.equal(computeFlag({ value: '5.6', referenceLow: 3.5, referenceHigh: 5.0, criticalHigh: 6.5 }), 'high');
  });

  it('flags critical_high when the critical bound is crossed', () => {
    const flag = computeFlag({ value: '6.8', referenceLow: 3.5, referenceHigh: 5.0, criticalHigh: 6.5 });
    assert.equal(flag, 'critical_high');
    assert.equal(isCriticalFlag(flag), true);
  });

  it('flags critical_low symmetrically', () => {
    assert.equal(computeFlag({ value: '1.9', referenceLow: 3.5, criticalLow: 2.0 }), 'critical_low');
  });

  it('defaults a non-numeric value to normal rather than guessing', () => {
    assert.equal(computeFlag({ value: 'positive', referenceLow: 0, referenceHigh: 10 }), 'normal');
  });
});

describe('ordering', () => {
  it('creates an order for the thread\u2019s patient', async () => {
    const { thread, profile } = await makePatient();
    const clinician = await makeClinician();

    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    assert.equal(order.patient_profile_id, profile.id);
    assert.equal(order.status, 'ordered');
  });

  it('refuses a non-clinician', async () => {
    const { thread } = await makePatient();
    await assert.rejects(
      () => investigations.createOrder(
        { sub: randomUUID(), role: 'patient' },
        { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
        meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('does not expose clinician-only clinical notes to the owning patient', async () => {
    const { user, thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      {
        care_thread_id: thread.id,
        investigation_code: 'SYNTHETIC-TEST',
        investigation_type: 'laboratory',
        clinical_notes: 'Synthetic clinician-only test note',
      },
      meta,
    );
    orderIds.push(order.id);

    const patientView = await investigations.getOrder(order.id, { sub: user.id, role: 'patient' });
    assert.equal(Object.hasOwn(patientView, 'clinical_notes'), false);

    const clinicianView = await investigations.getOrder(order.id, {
      sub: randomUUID(), role: 'clinician', cpid: clinician.id,
    });
    assert.equal(clinicianView.clinical_notes, 'Synthetic clinician-only test note');
  });
});

describe('filing results', () => {
  it('computes is_critical server-side from a breached critical bound', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'K', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    const result = await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Potassium', value: '6.8', reference_low: 3.5, reference_high: 5.0, critical_high: 6.5 }] },
      meta,
    );

    assert.equal(result.is_critical, true);
    assert.equal(result.values[0]!.flag, 'critical_high');

    const auditEntries = await prisma.auditLog.count({ where: { action: 'investigation.critical_result_filed', entityId: order.id } });
    assert.equal(auditEntries, 1);
  });

  it('does not mark a normal result critical', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    const result = await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5', reference_low: 12, reference_high: 16 }] },
      meta,
    );
    assert.equal(result.is_critical, false);
  });

  it('refuses a patient from filing a result', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await assert.rejects(
      () => investigations.fileResult(
        order.id, { sub: randomUUID(), role: 'patient' },
        { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
    await assert.rejects(
      () => investigations.fileResult(
        order.id, { sub: randomUUID(), role: 'patient', cpid: clinician.id },
        { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
    const adminResult = await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'platform_admin' },
      { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
    );
    assert.equal(adminResult.status, 'resulted');
  });

  it('refuses a different clinician from filing another clinician\u2019s result', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const otherClinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await assert.rejects(
      () => investigations.fileResult(
        order.id, { sub: randomUUID(), role: 'clinician', cpid: otherClinician.id },
        { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
      ),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });

  it('refuses to file a result twice', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
    );

    await assert.rejects(
      () => investigations.fileResult(
        order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
        { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
      ),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('acknowledging', () => {
  it('closes the loop on a critical result', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'K', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Potassium', value: '6.8', critical_high: 6.5 }] }, meta,
    );

    const acknowledged = await investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta);
    assert.equal(acknowledged.status, 'acknowledged');
    assert.ok(acknowledged.acknowledged_at);
  });

  it('refuses to acknowledge before a result exists', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    await assert.rejects(
      () => investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses to acknowledge the same result twice', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);
    await investigations.fileResult(
      order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { values: [{ analyte: 'Haemoglobin', value: '13.5' }] }, meta,
    );
    await investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta);

    await assert.rejects(
      () => investigations.acknowledgeResult(order.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id }, meta),
      (e: AppError) => e.code === 'RESULT_ALREADY_ACKNOWLEDGED',
    );
  });
});

describe('visibility', () => {
  it('refuses a stranger reading someone else\u2019s order', async () => {
    const { thread } = await makePatient();
    const clinician = await makeClinician();
    const order = await investigations.createOrder(
      { sub: randomUUID(), role: 'clinician', cpid: clinician.id },
      { care_thread_id: thread.id, investigation_code: 'FBC', investigation_type: 'laboratory' },
      meta,
    );
    orderIds.push(order.id);

    await assert.rejects(
      () => investigations.getOrder(order.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });
});
