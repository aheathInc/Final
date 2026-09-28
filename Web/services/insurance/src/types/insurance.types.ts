import { z } from 'zod';

export const getCoverageQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  facility_id: z.string().uuid().optional(),
});

export const submitClaimSchema = z.object({
  consultation_id: z.string().uuid(),
  scheme_id: z.string().uuid(),
  item_codes: z.array(z.string()).optional(),
});

export const listClaimsQuery = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected', 'paid']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
