import { z } from 'zod';

export const createConsultationSchema = z.object({
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  clinician_id: z.string().uuid().optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']),
  consultation_mode: z.enum(['hospital', 'remote']).optional(),
  facility_id: z.string().uuid().optional(),
  modality: z.enum(['chat', 'voice', 'video', 'async', 'in_person']).optional(),
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
}).superRefine((input, ctx) => {
  if (input.consultation_mode === 'hospital') {
    if (!input.facility_id) ctx.addIssue({ code: 'custom', path: ['facility_id'], message: 'Choose the hospital you will attend.' });
    if (input.modality && input.modality !== 'in_person') ctx.addIssue({ code: 'custom', path: ['modality'], message: 'Hospital consultations must be attended in person.' });
  } else {
    if (input.facility_id) ctx.addIssue({ code: 'custom', path: ['facility_id'], message: 'A visit destination applies only to hospital consultations.' });
    if (input.modality === 'in_person' || (input.consultation_mode === 'remote' && input.modality === 'async')) ctx.addIssue({ code: 'custom', path: ['modality'], message: 'Choose chat, voice or video for a remote consultation.' });
  }
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
            medication_image_url: z.string().url().max(1000).refine(url => url.startsWith('https://')).optional(),
            medication_education: z.string().trim().max(3000).optional(),
            dosage: z.string().min(1).max(50),
            frequency_per_day: z.number().int().min(1).max(12),
            duration_days: z.number().int().min(1).max(365),
            instructions: z.string().max(500).optional(),
            quantity_prescribed: z.number().int().min(1).max(100000).optional(),
          }),
        )
        .min(1),
      valid_until: z.string().date().optional(),
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
