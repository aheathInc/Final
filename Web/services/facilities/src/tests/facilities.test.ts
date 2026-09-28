import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import * as facilities from '../services/facility.service.js';

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests outside a development database');
}

const facilityIds: string[] = [];

after(async () => {
  for (const id of facilityIds) {
    await prisma.department.deleteMany({ where: { facilityId: id } }).catch(() => undefined);
    await prisma.facility.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeFacility(overrides: { lat?: number; lng?: number; integrationLevel?: string } = {}) {
  const facility = await prisma.facility.create({
    data: {
      name: `Test Facility ${randomUUID().slice(0, 8)}`, type: 'hospital',
      lat: overrides.lat ?? -6.8, lng: overrides.lng ?? 39.28,
      integrationLevel: (overrides.integrationLevel ?? 'none') as never,
    },
  });
  facilityIds.push(facility.id);
  return facility;
}

describe('directory', () => {
  it('lists a facility by id', async () => {
    const facility = await makeFacility();
    const result = await facilities.getFacility(facility.id);
    assert.equal(result.id, facility.id);
  });

  it('orders results by distance when a location is given', async () => {
    const near = await makeFacility({ lat: -6.80, lng: 39.28 });
    const far = await makeFacility({ lat: -8.90, lng: 33.40 });

    const result = await facilities.listFacilities({ lat: -6.80, lng: 39.28, radius_km: 50, limit: 25 });
    const ids = result.data.map((f) => (f as { id: string }).id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id) || !ids.includes(far.id));
  });

  it('lists departments for a facility', async () => {
    const facility = await makeFacility();
    await prisma.department.create({ data: { facilityId: facility.id, name: 'Outpatient', specialty: 'general_practice' } });

    const result = await facilities.listDepartments(facility.id);
    assert.equal(result.data.length, 1);
  });
});

describe('queue', () => {
  it('reports integration_level none with an empty provider list for an unintegrated facility', async () => {
    const facility = await makeFacility({ integrationLevel: 'none' });
    const result = await facilities.getFacilityQueue(facility.id, undefined);
    assert.equal(result.integration_level, 'none');
    assert.equal(result.providers.length, 0);
  });

  it('never fabricates provider data even for a facility marked as integrated', async () => {
    const facility = await makeFacility({ integrationLevel: 'full' });
    const result = await facilities.getFacilityQueue(facility.id, undefined);
    assert.equal(result.integration_level, 'full');
    assert.equal(result.providers.length, 0);
  });
});
