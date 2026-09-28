import { z } from 'zod';

// E.164 only. A local-format number is rejected at the edge rather than
// normalised silently, so two records can never describe the same person.
export const phoneNumber = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be E.164, e.g. +255712345678');

export const languageCode = z.enum(['sw', 'en', 'fr', 'ha', 'am']);
export const channel = z.enum(['app', 'sms', 'ussd', 'voice', 'web']);
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

export const registerPatientSchema = z.object({
  phone_number: phoneNumber,
  full_name: z.string().max(150).optional(),
  preferred_language: languageCode,
  channel: channel.optional(),
});

export const registerClinicianSchema = z.object({
  phone_number: phoneNumber,
  full_name: z.string().min(1).max(150),
  email: z.string().email().max(150),
  license_number: z.string().min(1).max(50),
  specialty,
  languages_spoken: z.array(languageCode).optional(),
  preferred_language: languageCode,
  facility_id: z.string().uuid().optional(),
  verification_document_keys: z.array(z.string()).optional(),
});

export const otpRequestSchema = z.object({
  phone_number: phoneNumber,
  channel: channel.optional(),
});

export const otpVerifySchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  device_id: z.string().max(128).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_id: z.string().max(128).optional(),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const updateMeSchema = z.object({
  base_version: z.number().int(),
  full_name: z.string().max(150).optional(),
  preferred_language: languageCode.optional(),
  default_location: z
    .object({ lat: z.number(), lng: z.number(), accuracy_metres: z.number().optional() })
    .optional(),
  region_code: z.string().max(20).optional(),
});

export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;
export type RegisterClinicianInput = z.infer<typeof registerClinicianSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const setPasswordSchema = z.object({
  new_password: z.string().min(1).max(200),
  // Omitted when the session was established by OTP, which is the reset path.
  current_password: z.string().max(200).optional(),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
