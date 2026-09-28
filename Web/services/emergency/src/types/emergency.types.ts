import { z } from 'zod';

export const createEmergencySchema = z.object({
  scale: z.enum(['individual', 'mass_casualty']),
  category: z.enum(['medical', 'trauma', 'obstetric', 'road_traffic', 'fire', 'other']).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  patient_profile_id: z.string().uuid().optional(),
  estimated_casualties: z.number().int().min(1).optional(),
  description: z.string().max(2000).optional(),
  reporter_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  source: z.enum(['patient_app', 'bystander', 'ussd', 'sms', 'voice', 'wearable', 'vehicle_sensor', 'facility']).optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
});

export const listEmergenciesQuery = z.object({
  status: z.enum(['reported', 'triaged', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled']).optional(),
  facility_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const dispatchSchema = z.object({
  transport_unit_id: z.string().uuid(),
  destination_facility_id: z.string().uuid(),
  notes: z.string().max(1000).optional(),
});

export const setStatusSchema = z.object({
  status: z.enum(['triaged', 'en_route', 'arrived', 'resolved', 'cancelled']),
  outcome: z.enum(['transported', 'treated_on_scene', 'refused_care', 'false_alarm', 'deceased']).optional(),
  notes: z.string().max(1000).optional(),
});

export const listUnitsQuery = z.object({
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']).optional(),
  near_lat: z.coerce.number().optional(),
  near_lng: z.coerce.number().optional(),
});

export const updateLocationSchema = z.object({
  location: z.object({ lat: z.number(), lng: z.number() }),
  heading_degrees: z.number().optional(),
  speed_kph: z.number().min(0).optional(),
});

export const setUnitStatusSchema = z.object({
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']),
});
