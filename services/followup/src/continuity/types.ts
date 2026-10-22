import { z } from 'zod';
export const scheduleSchema = z.object({
  base_version: z.number().int().min(0),
  start_date: z.string().date(), timezone: z.string().min(1).max(80),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(12),
}).strict();
export const planStateSchema = z.object({ base_version: z.number().int().positive(), status: z.enum(['active', 'paused', 'cancelled']) }).strict();
export const preferenceSchema = z.object({ base_version: z.number().int().min(0), sms_enabled: z.boolean() }).strict();
export const reviewSchema = z.object({ base_version: z.number().int().positive(), note: z.string().trim().max(2000).optional() }).strict();
export const contactSchema = z.object({
  request_key: z.string().uuid(), scheduled_at: z.string().datetime({ offset: true }),
  channel: z.enum(['phone', 'chat']), purpose: z.string().trim().min(1).max(500),
}).strict();
export const contactOutcomeSchema = z.object({
  base_version: z.number().int().positive(), status: z.enum(['completed', 'no_answer', 'cancelled']),
  note: z.string().trim().max(2000).optional(),
}).strict();
export const patientQuerySchema = z.object({ patient_profile_id: z.string().uuid().optional(), cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30) });
export const worklistQuerySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(['active', 'completed', 'cancelled']).default('active') });

export const medicationQuerySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const resourceIdSchema = z.string().uuid();
