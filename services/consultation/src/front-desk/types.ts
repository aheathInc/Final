import { z } from 'zod';

export const idSchema = z.string().uuid();
export const versionSchema = z.object({ base_version: z.number().int().positive() }).strict();
export const policySchema = z.object({
  base_version: z.number().int().positive(), enabled: z.boolean(),
  payment_required: z.boolean(), insurance_required: z.boolean(),
}).strict();
export const aliasesSchema = z.object({
  base_version: z.number().int().positive(),
  aliases: z.array(z.string().trim().min(2).max(60)).max(30),
}).strict();
export const navigationSchema = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
export const directoryQuery = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const visitListQuery = z.object({
  patient_profile_id: z.string().uuid().optional(), cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const staffListQuery = z.object({
  facility_id: z.string().uuid(), department_id: z.string().uuid().optional(),
  status: z.enum(['preregistered','awaiting_review','waiting','called','in_consultation','completed','cancelled']).optional(),
  cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const createVisitSchema = z.object({
  request_key: z.string().uuid(), patient_profile_id: z.string().uuid().optional(),
  facility_id: z.string().uuid(), department_id: z.string().uuid(),
  requested_clinician_id: z.string().uuid().optional(),
  purpose: z.string().trim().min(1).max(2000),
  share_with_department: z.literal(true),
  urgent_help_requested: z.boolean(),
}).strict();
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export const administrativeSchema = z.object({
  base_version: z.number().int().positive(), registration_confirmed: z.literal(true),
  payment_check: z.enum(['manually_verified','not_required']),
  insurance_check: z.enum(['manually_verified','not_required']),
  payment_reference: z.string().trim().min(1).max(120).optional(),
  insurance_reference: z.string().trim().min(1).max(120).optional(),
}).strict();
export type AdministrativeInput = z.infer<typeof administrativeSchema>;
export const clinicalSchema = z.object({
  base_version: z.number().int().positive(),
  decision: z.enum(['cleared','escalated']),
}).strict();
