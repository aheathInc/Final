import { z } from 'zod';

export const computeRiskScoresSchema = z.object({
  conditions: z.array(z.string()).optional(),
});

export const recordVaccinationSchema = z.object({
  vaccine_code: z.string().min(1).max(40),
  administered_at: z.string().datetime(),
  dose_number: z.number().int().min(1).optional(),
  facility_id: z.string().uuid().optional(),
  batch_number: z.string().max(60).optional(),
});

export const listInvitationsQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'accepted', 'declined', 'deferred', 'completed', 'expired']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const respondSchema = z.object({
  response: z.enum(['accept', 'decline', 'defer']),
  decline_reason: z.string().max(500).optional(),
  preferred_slot_id: z.string().uuid().optional(),
});
