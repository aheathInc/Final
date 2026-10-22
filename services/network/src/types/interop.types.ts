import { z } from 'zod';

export const FHIR_RESOURCE_TYPES = [
  'Patient', 'Organization', 'Practitioner', 'Encounter', 'Condition',
  'Observation', 'DiagnosticReport', 'MedicationRequest', 'AllergyIntolerance', 'Provenance',
] as const;

export const systemKeySchema = z.string().regex(/^[a-z][a-z0-9-]{2,59}$/);

export const registerExternalSystemSchema = z.object({
  system_key: systemKeySchema,
  name: z.string().trim().min(2).max(160),
  identifier: z.string().trim().min(3).max(255),
  facility_id: z.string().uuid(),
  supported_types: z.array(z.enum(FHIR_RESOURCE_TYPES)).min(1).max(FHIR_RESOURCE_TYPES.length),
}).strict();

export const reconcileIdentitySchema = z.object({
  patient_profile_id: z.string().uuid(),
  evidence_reference: z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/),
}).strict();

export const markAmbiguousSchema = z.object({
  candidate_patient_profile_ids: z.array(z.string().uuid()).min(2).max(10),
  evidence_reference: z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/),
}).strict();

export const rejectIdentitySchema = z.object({
  evidence_reference: z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/),
}).strict();

export const timelineQuerySchema = z.object({
  category: z.enum([
    'consultation', 'referral', 'diagnostic', 'medication', 'dispensing',
    'medical_record', 'encounter', 'condition', 'allergy',
  ]).optional(),
  source: z.enum(['ahp', 'external']).optional(),
}).strict();

export type FhirResourceType = (typeof FHIR_RESOURCE_TYPES)[number];
export type FhirResource = Record<string, unknown> & {
  resourceType: FhirResourceType;
  id: string;
  meta?: { versionId?: string; lastUpdated?: string };
};
