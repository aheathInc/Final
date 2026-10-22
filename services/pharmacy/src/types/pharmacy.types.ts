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
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().optional(),
  required_quantity: z.coerce.number().int().min(1).max(100000).optional(),
}).refine((value) => (value.lat === undefined) === (value.lng === undefined), 'lat and lng must be supplied together');

export const verifyDispenseCodeSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  pharmacy_id: z.string().uuid(),
}).strict();

export const issueHandoffSchema = z.object({}).strict();

export const completeDispensingSchema = z.object({
  idempotency_key: z.string().min(16).max(128),
  items: z.array(z.object({
    prescription_item_id: z.string().uuid(),
    quantity_dispensed: z.number().int().min(1).max(100000),
  }).strict()).min(1),
}).strict();
