import { z } from 'zod';

export const registerDeviceSchema = z.object({
  device_type: z.enum(['wearable_watch', 'vehicle_sensor', 'bp_monitor', 'glucometer', 'pulse_oximeter']),
  serial_number: z.string().min(1).max(100),
  patient_profile_id: z.string().uuid().optional(),
  vehicle_registration: z.string().max(40).optional(),
  label: z.string().max(100).optional(),
});

const geoPoint = z.object({ lat: z.number(), lng: z.number(), accuracy_metres: z.number().optional() });

export const telemetryReadingSchema = z.object({
  metric: z.enum(['heart_rate', 'spo2', 'systolic', 'diastolic', 'glucose', 'temperature', 'steps', 'motion', 'impact_g']),
  value: z.number(),
  unit: z.string().nullable().optional(),
  recorded_at: z.string().datetime(),
});

export const ingestTelemetrySchema = z.object({
  readings: z.array(telemetryReadingSchema).max(500).min(1),
});

export const raiseAlertSchema = z.object({
  alert_type: z.enum(['fall_detected', 'collision_detected', 'heart_rate_abnormal', 'spo2_low', 'no_motion', 'manual_trigger']),
  detected_at: z.string().datetime(),
  location: geoPoint.optional(),
  confidence: z.number().min(0).max(1).optional(),
  readings: z.array(telemetryReadingSchema).optional(),
});
