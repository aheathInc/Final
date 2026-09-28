import { z } from 'zod';

export const specialty = z.enum([
  'general_practice',
  'internal_medicine',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
  'psychiatry',
  'dermatology',
  'other',
]);

export const verificationStatus = z.enum(['pending', 'verified', 'rejected']);
export const modality = z.enum(['chat', 'voice', 'video', 'async']);

export const listCliniciansQuery = z.object({
  facility_id: z.string().uuid().optional(),
  verification_status: verificationStatus.optional(),
  specialty: specialty.optional(),
  is_available: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const verificationDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(1000).optional(),
  })
  // A rejection a clinician cannot act on is a dead end, so the reason is
  // required rather than merely encouraged.
  .refine((v) => v.decision === 'approve' || (v.reason && v.reason.length > 0), {
    message: 'A reason is required when rejecting',
    path: ['reason'],
  });

export const availabilitySchema = z.object({
  is_available: z.boolean(),
  until: z.string().datetime().optional(),
});

export const publishSlotsSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  slots: z
    .array(
      z.object({
        starts_at: z.string().datetime(),
        duration_minutes: z.number().int().min(5).max(120),
        modality: modality.default('chat'),
      }),
    )
    .max(500),
});

export const slotsQuery = z.object({
  from: z.string().date(),
  to: z.string().date(),
});

export type PublishSlotsInput = z.infer<typeof publishSlotsSchema>;
