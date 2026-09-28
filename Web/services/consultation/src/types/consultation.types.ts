import { z } from 'zod';

export const createConsultationSchema = z.object({
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  clinician_id: z.string().uuid().optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']),
  modality: z.enum(['chat', 'voice', 'video', 'async']).optional(),
  symptom_text: z.string().max(4000).optional(),
  structured_symptoms: z
    .array(
      z.object({
        code: z.string().max(60),
        severity: z.number().int().min(0).max(10).optional(),
        duration_hours: z.number().min(0).optional(),
      }),
    )
    .max(30)
    .optional(),
  voice_note_key: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const declineSchema = z.object({
  reason: z.enum(['out_of_specialty', 'language_mismatch', 'at_capacity', 'other']).optional(),
  note: z.string().max(1000).optional(),
});

export const completeSchema = z.object({
  note: z.object({
    diagnosis_text: z.string().min(1).max(4000),
    diagnosis_codes: z.array(z.string()).optional(),
    advice_text: z.string().min(1).max(4000),
    red_flags_discussed: z.array(z.string()).optional(),
  }),
  prescription: z
    .object({
      items: z
        .array(
          z.object({
            medication_name: z.string().min(1).max(150),
            dosage: z.string().min(1).max(50),
            frequency_per_day: z.number().int().min(1).max(12),
            duration_days: z.number().int().min(1).max(365),
            instructions: z.string().max(500).optional(),
          }),
        )
        .min(1),
    })
    .optional(),
  follow_up_cycle: z
    .object({
      frequency: z.enum(['daily', 'twice_daily', 'weekly', 'custom']),
      custom_cron: z.string().max(120).optional(),
      duration_days: z.number().int().min(1).max(365),
      questionnaire_key: z.string().max(80).optional(),
      recovery_criteria: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  close_care_thread: z.boolean().optional(),
});

export const referSchema = z.object({
  specialty: z.string().max(60),
  to_clinician_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000),
});

export const closeThreadSchema = z.object({
  outcome: z.enum(['recovered', 'referred_out', 'lost_to_follow_up', 'deceased']),
  notes: z.string().max(2000).optional(),
});

export const listQuery = z.object({
  patient_id: z.string().uuid().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const queueQuery = z.object({
  scope: z.enum(['offered', 'mine']).default('offered'),
  urgency_level: z.enum(['routine', 'urgent', 'emergency']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
