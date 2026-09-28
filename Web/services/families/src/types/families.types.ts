import { z } from 'zod';

export const createFamilySchema = z.object({
  name: z.string().min(1).max(150),
  subscription_tier: z.enum(['none', 'family_basic', 'family_plus']).optional(),
});

export const addMemberSchema = z.object({
  patient_profile_id: z.string().uuid(),
  relationship: z.enum(['head', 'spouse', 'child', 'parent', 'sibling', 'dependant', 'other']),
});

export const assignDoctorsSchema = z.object({
  gp_clinician_id: z.string().uuid().optional(),
  obgyn_clinician_id: z.string().uuid().optional(),
}).refine((v) => v.gp_clinician_id || v.obgyn_clinician_id, {
  message: 'At least one of gp_clinician_id or obgyn_clinician_id is required',
});
