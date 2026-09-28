import { prisma } from '@a-health/database';
import { cursorArgs, notFound, toCursorPage } from '@a-health/http';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function serialise(f: {
  id: string; name: string; type: string; lat: number | null; lng: number | null;
  regionCode: string | null; contactPhone: string | null; integrationLevel: string;
}, distanceKm?: number) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    location: f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null,
    distance_km: distanceKm ?? null,
    region_code: f.regionCode,
    contact_phone: f.contactPhone,
    integration_level: f.integrationLevel,
  };
}

export async function listFacilities(query: {
  type?: string; region_code?: string; lat?: number; lng?: number; radius_km?: number;
  cursor?: string; limit: number;
}) {
  const rows = await prisma.facility.findMany({
    where: {
      isActive: true,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.region_code ? { regionCode: query.region_code } : {}),
    },
    orderBy: { name: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });

  if (query.lat == null || query.lng == null) {
    return toCursorPage(rows, query.limit, (r) => serialise(r));
  }

  const radius = query.radius_km ?? 25;
  const withDistance = rows
    .map((r) => ({
      row: r,
      distance: r.lat != null && r.lng != null ? haversineKm(query.lat!, query.lng!, r.lat, r.lng) : undefined,
    }))
    .filter((x) => x.distance === undefined || x.distance <= radius)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  return toCursorPage(withDistance.map((x) => x.row), query.limit, (row) =>
    serialise(row, withDistance.find((x) => x.row.id === row.id)?.distance));
}

export async function getFacility(id: string) {
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) throw notFound('Facility not found');
  return serialise(facility);
}

export async function listDepartments(facilityId: string) {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw notFound('Facility not found');

  const rows = await prisma.department.findMany({ where: { facilityId, isActive: true }, orderBy: { name: 'asc' } });
  return {
    data: rows.map((d) => ({ id: d.id, facility_id: d.facilityId, name: d.name, specialty: d.specialty })),
  };
}

/**
 * The congestion feature — but only where it is honest. A facility with no
 * live feed reports `integration_level: none` and an empty provider list,
 * exactly as documented in the contract, rather than a wait-time estimate
 * nobody actually measured. No live-queue data source is wired into this
 * platform yet for ANY integration level, so every facility currently
 * returns this shape — the field exists so a future data feed has
 * somewhere real to plug in, not to imply one already does.
 */
export async function getFacilityQueue(facilityId: string, departmentId: string | undefined) {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw notFound('Facility not found');

  return {
    facility_id: facility.id,
    integration_level: facility.integrationLevel,
    department_id: departmentId ?? null,
    observed_at: new Date().toISOString(),
    providers: [] as unknown[],
  };
}
