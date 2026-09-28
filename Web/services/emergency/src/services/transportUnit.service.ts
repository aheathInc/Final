import { prisma } from '@a-health/database';
import { notFound } from '@a-health/http';

function serialise(u: {
  id: string; callSign: string; capability: string; status: string;
  lat: number | null; lng: number | null; locationUpdatedAt: Date | null;
}, distanceKm?: number) {
  return {
    id: u.id,
    call_sign: u.callSign,
    capability: u.capability,
    status: u.status,
    location: u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null,
    distance_km: distanceKm ?? null,
    location_updated_at: u.locationUpdatedAt?.toISOString() ?? null,
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function listTransportUnits(query: {
  status?: string; near_lat?: number; near_lng?: number;
}) {
  const rows = await prisma.transportUnit.findMany({
    where: { ...(query.status ? { status: query.status as never } : {}) },
    take: 200,
  });

  const withDistance = rows.map((u) => {
    const distance =
      query.near_lat != null && query.near_lng != null && u.lat != null && u.lng != null
        ? haversineKm(query.near_lat, query.near_lng, u.lat, u.lng)
        : undefined;
    return { unit: u, distance };
  });

  if (query.near_lat != null && query.near_lng != null) {
    withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  return { data: withDistance.map(({ unit, distance }) => serialise(unit, distance)) };
}

/**
 * High frequency, low value individually. A live position matters; a month of
 * breadcrumbs does not — this writes the cached position on the unit for fast
 * reads, plus one TransportPing row for the trail, and does not audit-log
 * each call, which at this volume would drown every other entry in the log.
 */
export async function updateTransportLocation(
  unitId: string,
  input: { location: { lat: number; lng: number }; heading_degrees?: number; speed_kph?: number },
) {
  const unit = await prisma.transportUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Transport unit not found');

  await prisma.$transaction([
    prisma.transportUnit.update({
      where: { id: unitId },
      data: { lat: input.location.lat, lng: input.location.lng, locationUpdatedAt: new Date() },
    }),
    prisma.transportPing.create({
      data: {
        unitId,
        lat: input.location.lat,
        lng: input.location.lng,
        headingDegrees: input.heading_degrees ?? null,
        speedKph: input.speed_kph ?? null,
      },
    }),
  ]);
}

export async function setTransportStatus(unitId: string, status: string) {
  const unit = await prisma.transportUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Transport unit not found');

  const updated = await prisma.transportUnit.update({
    where: { id: unitId },
    data: { status: status as never, version: { increment: 1 } },
  });
  return serialise(updated);
}
