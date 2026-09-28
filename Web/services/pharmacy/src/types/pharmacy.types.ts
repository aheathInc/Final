import { z } from 'zod';

export const listPharmaciesQuery = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius_km: z.coerce.number().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const searchMedicationQuery = z.object({
  medication_name: z.string().min(1),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius_km: z.coerce.number().optional(),
});

export const verifyDispenseCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  pharmacy_id: z.string().uuid(),
});

export const completeDispensingSchema = z.object({
  items: z.array(z.object({
    prescription_item_id: z.string().uuid(),
    quantity_dispensed: z.number().int().min(1),
    substituted_with: z.string().max(150).optional(),
    substitution_approved_by: z.string().uuid().optional(),
  })).min(1),
});
