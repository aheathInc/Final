import { z } from 'zod';

export const respondSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const closeCycleSchema = z.object({
  outcome: z.enum(['recovered', 'escalated', 'lost_to_follow_up']),
  notes: z.string().max(2000).optional(),
});

export const confirmAdherenceSchema = z.object({
  reported_status: z.enum(['taken', 'missed', 'delayed']),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
  note: z.string().max(500).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const listCheckInsQuery = z.object({
  status: z.enum(['scheduled', 'responded', 'missed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listAdherenceQuery = z.object({
  patient_profile_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  reported_status: z.enum(['taken', 'missed', 'delayed', 'unreported']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type RespondInput = z.infer<typeof respondSchema>;
export type ConfirmAdherenceInput = z.infer<typeof confirmAdherenceSchema>;
