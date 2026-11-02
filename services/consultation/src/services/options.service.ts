import { prisma } from '@a-health/database';
import { otherCareChargesPolicy } from '@a-health/database/consultation-billing';

/** A directory for the request form, with no patient or staff identifiers. */
export async function consultationOptions() {
  const facilities = await prisma.facility.findMany({
    where: { isActive: true, type: { in: ['hospital', 'clinic'] } },
    select: { id: true, name: true, regionCode: true }, orderBy: { name: 'asc' },
  });
  return {
    modes: ['hospital', 'remote'],
    remote_modalities: ['video', 'voice', 'chat'],
    remote_fees: { general_practice: 5000, specialist: 8000, currency: 'TZS' },
    billing_policy: { hospital_consultation: 'Free', other_charges: otherCareChargesPolicy },
    facilities: facilities.map(f => ({ id: f.id, name: f.name, region_code: f.regionCode })),
  };
}
