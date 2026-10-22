import { z } from 'zod';

export const listFacilitiesQuery = z.object({
  type: z.enum(['hospital', 'clinic', 'pharmacy', 'transport_partner', 'laboratory', 'imaging_centre']).optional(),
  region_code: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius_km: z.coerce.number().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const facilityQueueQuery = z.object({
  department_id: z.string().uuid().optional(),
});
