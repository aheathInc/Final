import { z } from 'zod';

export const referralListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const referralAuthorizationsQuery = z.object({
  consultation_id: z.string().uuid(),
});

export const createReferralSchema = z.object({
  consultation_id: z.string().uuid(),
  destination_facility_id: z.string().uuid(),
  destination_department_id: z.string().uuid().optional(),
  destination_clinician_id: z.string().uuid().optional(),
  patient_consent_id: z.string().uuid(),
  purpose: z.string().trim().min(5).max(1000),
  clinical_summary: z.string().trim().min(5).max(4000),
  priority: z.enum(['routine', 'urgent', 'emergency']).default('routine'),
});

export const declineReferralSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const completeReferralSchema = z.object({
  outcome_status: z.enum(['care_provided', 'redirected', 'unable_to_complete']),
  follow_up_recommendation: z.string().trim().max(1000).optional(),
  patient_instructions: z.string().trim().max(1000).optional(),
});

export type CreateReferralInput = z.infer<typeof createReferralSchema>;
export type CompleteReferralInput = z.infer<typeof completeReferralSchema>;
