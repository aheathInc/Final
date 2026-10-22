import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import type { AppError } from '@a-health/http';
import { bus } from '../events.js';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import { isLegalStatusTransition, canDispatch } from '../services/transition.js';

let testDatabase: URL;
try {
  testDatabase = new URL(process.env.DATABASE_URL ?? '');
} catch {
  throw new Error('Refusing emergency tests without a valid local ahealth_test DATABASE_URL.');
}
if (
  decodeURIComponent(testDatabase.pathname.replace(/^\//, '')) !== 'ahealth_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(testDatabase.hostname) ||
  (testDatabase.port || '5432') === '5432'
) {
  throw new Error('Refusing emergency tests unless DATABASE_URL targets local ahealth_test on a non-5432 port.');
}

const meta = { ip: '127.0.0.1', requestId: 'test' };
const dispatcher = { sub: randomUUID(), role: 'dispatcher' };
const users: string[] = [];
const emergencyIds: string[] = [];
const unitIds: string[] = [];
const facilityIds: string[] = [];

after(async () => {
  for (const id of emergencyIds) {
    await prisma.emergencyEvent.deleteMany({ where: { emergencyId: id } }).catch(() => undefined);
    await prisma.emergencyRequest.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of unitIds) {
    await prisma.transportPing.deleteMany({ where: { unitId: id } }).catch(() => undefined);
    await prisma.transportUnit.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of facilityIds) {
    await prisma.facility.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await bus.close();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Emergency Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Emergency Test' } });
  return { user, profile };
}

async function makeUnit(status = 'available') {
  const unit = await prisma.transportUnit.create({
    data: { callSign: `T-${randomInt(1000, 9999)}`, capability: 'basic', status: status as never, lat: -6.8, lng: 39.28 },
  });
  unitIds.push(unit.id);
  return unit;
}

async function makeFacility() {
  const facility = await prisma.facility.create({
    data: { name: 'Test Facility', type: 'hospital', lat: -6.79, lng: 39.27 },
  });
  facilityIds.push(facility.id);
  return facility;
}

describe('transition rules', () => {
  it('never allows entering dispatched via the status endpoint', () => {
    assert.equal(isLegalStatusTransition('reported', 'dispatched'), false);
    assert.equal(isLegalStatusTransition('triaged', 'dispatched'), false);
  });

  it('allows dispatch action only from reported or triaged', () => {
    assert.equal(canDispatch('reported'), true);
    assert.equal(canDispatch('triaged'), true);
    assert.equal(canDispatch('dispatched'), false);
    assert.equal(canDispatch('resolved'), false);
  });

  it('allows cancellation from any active state', () => {
    for (const s of ['reported', 'triaged', 'dispatched', 'en_route', 'arrived'] as const) {
      assert.equal(isLegalStatusTransition(s, 'cancelled'), true);
    }
  });
});

describe('reporting', () => {
  it('accepts a report with no authenticated caller', async () => {
    const result = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, source: 'bystander' },
    );
    emergencyIds.push(result.id);
    assert.equal(result.status, 'reported');
    assert.equal(result.source, 'bystander');
  });

  it('defaults source to patient_app for an authenticated caller', async () => {
    const { user } = await makePatient();
    const result = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(result.id);
    assert.equal(result.source, 'patient_app');
  });
});

describe('visibility', () => {
  it('lets the reporter see their own report', async () => {
    const { user } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const fetched = await emergencies.getEmergencyRequest(created.id, { sub: user.id, role: 'patient' });
    assert.equal(fetched.id, created.id);
  });

  it('refuses a stranger', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.getEmergencyRequest(created.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses list to a non-dispatcher', async () => {
    await assert.rejects(
      () => emergencies.listEmergencyRequests({ sub: randomUUID(), role: 'patient' }, { limit: 10 }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('dispatch', () => {
  it('dispatches to an available unit and facility', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta,
    );
    assert.equal(result.status, 'dispatched');

    const reloadedUnit = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloadedUnit.status, 'dispatched');
  });

  it('refuses to dispatch an out-of-service unit', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('out_of_service');
    const facility = await makeFacility();

    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses to dispatch an already-dispatched emergency', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    const unit2 = await makeUnit('available');
    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit2.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('writes a break-glass audit entry when the patient has no standing consent', async () => {
    const { user, profile } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta,
    );
    assert.equal(result.break_glass, true);

    const entries = await prisma.auditLog.count({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(entries, 1);
    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(event.actorUserId, dispatcher.sub);
    assert.deepEqual(event.metadata, { emergencyRequestId: created.id });
    assert.equal('allergies' in (event.metadata as object), false);
  });

  it('uses active emergency consent and switches to audited break-glass after revocation', async () => {
    const { user, profile } = await makePatient();
    const consent = await prisma.patientConsent.create({
      data: {
        patientProfileId: profile.id,
        granteeType: 'emergency_responder',
        scope: 'emergency_minimum',
        reason: 'Synthetic consent lifecycle test',
      },
    });

    const activeRequest = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(activeRequest.id);
    const activeUnit = await makeUnit('available');
    const activeFacility = await makeFacility();
    const activeDispatch = await emergencies.dispatchEmergency(
      activeRequest.id, dispatcher,
      { transport_unit_id: activeUnit.id, destination_facility_id: activeFacility.id }, meta,
    );
    assert.equal(activeDispatch.break_glass, false);

    await prisma.patientConsent.update({
      where: { id: consent.id },
      data: { allowed: false, revokedAt: new Date() },
    });
    const revokedRequest = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(revokedRequest.id);
    const revokedUnit = await makeUnit('available');
    const revokedFacility = await makeFacility();
    const revokedDispatch = await emergencies.dispatchEmergency(
      revokedRequest.id, dispatcher,
      { transport_unit_id: revokedUnit.id, destination_facility_id: revokedFacility.id }, meta,
    );
    assert.equal(revokedDispatch.break_glass, true);

    const entries = await prisma.auditLog.count({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(entries, 1);
  });
});

describe('status transitions', () => {
  it('walks a full lifecycle to resolved', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);
    const resolved = await emergencies.setEmergencyStatus(
      created.id, dispatcher, { status: 'resolved', outcome: 'transported' }, meta,
    );
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.outcome, 'transported');
  });

  it('refuses to resolve without an outcome', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);

    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'resolved' }, meta),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('refuses an illegal jump from reported to arrived', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' as never }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('transport units', () => {
  it('orders results by distance when a location is given', async () => {
    const near = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: near.id }, data: { lat: -6.80, lng: 39.28 } });
    const far = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: far.id }, data: { lat: -7.50, lng: 39.90 } });

    const result = await units.listTransportUnits({ status: 'available', near_lat: -6.80, near_lng: 39.28 });
    const ids = result.data.map((u) => u.id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id));
  });

  it('records a ping and updates the cached position on a location update', async () => {
    const unit = await makeUnit('en_route');
    await units.updateTransportLocation(unit.id, { location: { lat: -6.81, lng: 39.29 } });

    const reloaded = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloaded.lat, -6.81);

    const pings = await prisma.transportPing.count({ where: { unitId: unit.id } });
    assert.equal(pings, 1);
  });

  it('sets a unit status', async () => {
    const unit = await makeUnit('available');
    const updated = await units.setTransportStatus(unit.id, 'out_of_service');
    assert.equal(updated.status, 'out_of_service');
  });
});
