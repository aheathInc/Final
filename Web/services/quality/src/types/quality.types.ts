import { z } from 'zod';

export const rateConsultationSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const createIncidentSchema = z.object({
  category: z.enum(['clinical_care', 'misconduct', 'medication_error', 'delayed_response', 'data_privacy', 'ai_error', 'other']),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  description: z.string().min(1).max(4000),
  consultation_id: z.string().uuid().optional(),
  clinician_id: z.string().uuid().optional(),
  facility_id: z.string().uuid().optional(),
  anonymous: z.boolean().optional(),
});

export const listIncidentsQuery = z.object({
  status: z.enum(['reported', 'under_investigation', 'action_taken', 'closed']).optional(),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
