import { z } from 'zod';

export const createConversationSchema = z.object({
  audience: z.enum(['patient', 'clinician']),
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  voice_note_key: z.string().optional(),
});

export const triageSchema = z.object({
  symptom_text: z.string().max(4000).optional(),
  structured_symptoms: z.array(z.object({ code: z.string(), severity: z.number().min(0).max(10).optional() })).optional(),
  patient_profile_id: z.string().uuid().optional(),
});

export const drugInteractionSchema = z.object({
  medications: z.array(z.string()).min(1),
  patient_profile_id: z.string().uuid().optional(),
});

export const transcribeSchema = z.object({
  audio_key: z.string().min(1),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
});

export const synthesizeSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(['sw', 'en', 'fr', 'ha', 'am']).optional(),
});
