import { prisma } from '@a-health/database';
import { toCursorPage } from '@a-health/http';

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

  const start = query.cursor ? filtered.findIndex(x => x.row.id === query.cursor) + 1 : 0;
  return toCursorPage(
    filtered.slice(start, start + query.limit + 1).map((x) => x.row),
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
  medication_name: string; lat?: number; lng?: number; radius_km?: number; required_quantity?: number;
}) {
  const radius = input.radius_km ?? 15;
  const hasLocation = input.lat !== undefined && input.lng !== undefined;

  const stock = await prisma.pharmacyStock.findMany({
    where: {
      medicationName: { contains: input.medication_name, mode: 'insensitive' },
      pharmacy: { isVerified: true, isActive: true },
    },
    include: { pharmacy: true },

  });

  const withDistance = stock
    .map((s) => ({
      stock: s,
      distance:
        hasLocation && s.pharmacy.lat != null && s.pharmacy.lng != null
          ? haversineKm(input.lat!, input.lng!, s.pharmacy.lat, s.pharmacy.lng)
          : undefined,
    }))
    .filter((x) => !hasLocation || (x.distance !== undefined && x.distance <= radius))
    .sort((a, b) => hasLocation
      ? (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
      : a.stock.pharmacy.name.localeCompare(b.stock.pharmacy.name));

  return {
    data: withDistance.slice(0,200).map(({ stock: s, distance }) => {
      const fresh=Date.now()-s.lastReportedAt.getTime()<=24*60*60*1000 && s.lastReportedAt.getTime()<=Date.now();
      const reliable=fresh && s.quantityOnHand!==null && ((['in_stock','low_stock'].includes(s.stockStatus) && s.quantityOnHand>0) || (s.stockStatus==='out_of_stock' && s.quantityOnHand===0));
      return ({
      pharmacy: serialisePharmacy(s.pharmacy, distance),
      medication_name: s.medicationName,
      stock_status: reliable ? s.stockStatus : 'unknown',
      inventory_fresh: fresh,
      availability_note: reliable ? 'Reported by pharmacy; confirm before travelling.' : 'Availability not confirmed. Contact the pharmacy.',
      quantity_on_hand: reliable ? s.quantityOnHand : null,
      fulfillment_status: !reliable || s.quantityOnHand == null
        ? 'unknown'
        : s.quantityOnHand <= 0
          ? 'unavailable'
          : input.required_quantity == null || s.quantityOnHand >= input.required_quantity
            ? 'available'
            : 'partially_available',
      unit_price: s.unitPrice ? Number(s.unitPrice) : null,
      currency: s.currency,
      // Stock data ages fast. A stale figure sends someone on a journey for
      // nothing, so the age travels with the answer.
      last_reported_at: s.lastReportedAt.toISOString(),
    });}),
    truncated: withDistance.length>200,
    freshness_hours:24,
  };
}
