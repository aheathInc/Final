import axios from 'axios';

export const api = axios.create({
  baseURL: '/bff',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

export function idem() {
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { headers: { 'Idempotency-Key': key } };
}

export function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } } } };
  return err?.response?.data?.error?.message ?? fallback;
}

export interface Page<T> { data: T[]; meta?: { next_cursor?: string | null; has_more?: boolean } }

export type EmergencyStatus =
  | 'reported' | 'triaged' | 'dispatched' | 'en_route' | 'arrived' | 'resolved' | 'cancelled';

export interface EmergencyRequest {
  id: string;
  scale: 'individual' | 'mass_casualty';
  category: string;
  source: string;
  status: EmergencyStatus;
  outcome: string | null;
  location: { lat: number; lng: number };
  patient_profile_id: string | null;
  estimated_casualties: number | null;
  description: string | null;
  transport_unit_id: string | null;
  destination_facility_id: string | null;
  reported_at: string;
  dispatched_at: string | null;
  arrived_at: string | null;
  resolved_at: string | null;
}

export interface TransportUnit {
  id: string;
  call_sign: string;
  capability: string;
  status: string;
  location: { lat: number; lng: number } | null;
  distance_km: number | null;
  location_updated_at: string | null;
}

export interface Facility {
  id: string;
  name: string;
  type: string;
  location: { lat: number; lng: number } | null;
  region_code: string | null;
  contact_phone: string | null;
  integration_level: string;
  distance_km?: number | null;
}

export interface Device {
  id: string;
  device_type: string;
  serial_number: string;
  patient_profile_id: string | null;
  vehicle_registration: string | null;
  label: string | null;
  status: string;
  last_seen_at: string | null;
  battery_percent: number | null;
}

export interface IncidentReport {
  id: string;
  category: string;
  severity: 'low' | 'moderate' | 'serious' | 'catastrophic';
  status: string;
  description: string;
  anonymous: boolean;
  escalated_to_governance: boolean;
  reported_at: string;
  closed_at: string | null;
}

export interface Payment {
  id: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  method: string;
  provider: string | null;
  provider_reference: string | null;
  purpose: string;
  status: string;
  refunded_amount: number;
  settled_at: string;
}

export interface ClinicianProfile {
  id: string;
  full_name?: string | null;
  license_number: string;
  specialty: string;
  verification_status: 'pending' | 'verified' | 'rejected' | 'suspended';
  is_available: boolean;
  rating_avg?: number | null;
  created_at?: string;
}
