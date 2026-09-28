import { prisma } from '@a-health/database';
import { cursorArgs, toCursorPage } from '@a-health/http';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function serialisePharmacy(p: {
  id: string; name: string; licenseNumber: string; isVerified: boolean;
  lat: number | null; lng: number | null; contactPhone: string | null; openingHours: string | null;
}, distanceKm?: number) {
  return {
    id: p.id,
    name: p.name,
    license_number: p.licenseNumber,
    is_verified: p.isVerified,
    location: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
    distance_km: distanceKm ?? null,
    contact_phone: p.contactPhone,
    opening_hours: p.openingHours,
  };
}

export async function listPharmacies(query: {
  lat?: number; lng?: number; radius_km?: number; cursor?: string; limit: number;
}) {
  const rows = await prisma.pharmacy.findMany({
    // Only verified, appropriately licensed pharmacies participate — checked
    // on every read, not just at onboarding.
    where: { isVerified: true, isActive: true },
    orderBy: { name: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });

  const withDistance = rows.map((p) => ({
    row: p,
    distance:
      query.lat != null && query.lng != null && p.lat != null && p.lng != null
        ? haversineKm(query.lat, query.lng, p.lat, p.lng)
        : undefined,
  }));

  const radius = query.radius_km ?? 10;
  const filtered = query.lat != null && query.lng != null
    ? withDistance.filter((x) => x.distance !== undefined && x.distance <= radius)
    : withDistance;

  filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  return toCursorPage(
    filtered.map((x) => x.row),
    query.limit,
    (row) => serialisePharmacy(row, filtered.find((x) => x.row.id === row.id)?.distance),
  );
}

/**
 * A prescription is not treatment; obtaining the medicine is. When the point
 * of care has none, this answers where it is — with distance and stock
 * status visible before the patient travels, rather than after.
 */
export async function searchMedication(input: {
  medication_name: string; lat: number; lng: number; radius_km?: number;
}) {
  const radius = input.radius_km ?? 15;

  const stock = await prisma.pharmacyStock.findMany({
    where: {
      medicationName: { contains: input.medication_name, mode: 'insensitive' },
      pharmacy: { isVerified: true, isActive: true },
    },
    include: { pharmacy: true },
    take: 200,
  });

  const withDistance = stock
    .map((s) => ({
      stock: s,
      distance:
        s.pharmacy.lat != null && s.pharmacy.lng != null
          ? haversineKm(input.lat, input.lng, s.pharmacy.lat, s.pharmacy.lng)
          : undefined,
    }))
    .filter((x) => x.distance !== undefined && x.distance <= radius)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  return {
    data: withDistance.map(({ stock: s, distance }) => ({
      pharmacy: serialisePharmacy(s.pharmacy, distance),
      medication_name: s.medicationName,
      stock_status: s.stockStatus,
      unit_price: s.unitPrice ? Number(s.unitPrice) : null,
      currency: s.currency,
      // Stock data ages fast. A stale figure sends someone on a journey for
      // nothing, so the age travels with the answer.
      last_reported_at: s.lastReportedAt.toISOString(),
    })),
  };
}
