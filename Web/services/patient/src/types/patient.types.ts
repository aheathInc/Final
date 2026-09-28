import { z } from 'zod';

export const sex = z.enum(['male', 'female', 'other']);

export const geoPoint = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy_metres: z.number().optional(),
});

export const createDependentSchema = z.object({
  full_name: z.string().min(1).max(150),
  date_of_birth: z.string().date(),
  sex,
  chronic_conditions: z.array(z.string()).max(50).optional(),
  allergies: z.array(z.string()).max(50).optional(),
});

export const updateProfileSchema = z.object({
  base_version: z.number().int(),
  full_name: z.string().min(1).max(150).optional(),
  date_of_birth: z.string().date().optional(),
  sex: sex.optional(),
  blood_type: z.string().max(5).optional(),
  chronic_conditions: z.array(z.string()).max(50).optional(),
  allergies: z.array(z.string()).max(50).optional(),
  emergency_contact: z.string().max(100).nullable().optional(),
  default_location: geoPoint.optional(),
  region_code: z.string().max(20).optional(),
});

export const grantConsentSchema = z.object({
  grantee_type: z.enum(['clinician', 'facility', 'researcher', 'emergency_responder']),
  grantee_clinician_id: z.string().uuid().optional(),
  grantee_facility_id: z.string().uuid().optional(),
  care_thread_id: z.string().uuid().optional(),
  scope: z.enum(['full_history', 'current_thread', 'medications_only', 'investigations_only', 'emergency_minimum']),
  expires_at: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

export const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateDependentInput = z.infer<typeof createDependentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type GrantConsentInput = z.infer<typeof grantConsentSchema>;
