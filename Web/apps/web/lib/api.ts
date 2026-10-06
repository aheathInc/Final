import axios from 'axios';

/**
 * The single client for the whole console. Everything goes through /bff,
 * which attaches the session token server-side — no component holds a
 * credential, and none needs to know which of the twenty-odd services
 * answers a given path.
 */
export const api = axios.create({
  baseURL: '/bff',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

/**
 * A fresh key per attempt. Accepting a case twice because a tap registered
 * twice would take a second patient's slot; a genuine retry after a timeout
 * stays safe.
 */
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

// --- shared shapes ---------------------------------------------------------

export interface Page<T> { data: T[]; meta?: { next_cursor?: string | null; has_more?: boolean } }

export type Urgency = 'routine' | 'urgent' | 'emergency';

export interface Consultation {
  id: string;
  care_thread_id: string;
  patient_profile_id: string;
  assigned_clinician_id: string | null;
  urgency_level: Urgency;
  symptom_text: string | null;
  channel: string;
  modality: string;
  status: string;
  sla_deadline_at: string;
  created_at: string;
}

export interface QueueEntry {
  consultation: Consultation;
  patient_summary?: {
    age_band?: string | null;
    sex?: string | null;
    preferred_language?: string | null;
    has_chronic_conditions?: boolean;
  };
  offered_at: string;
  offer?: { state: string; expires_at: string };
  seconds_to_sla_breach?: number;
  rank_score?: number;
}

export interface Message {
  id: string;
  care_thread_id: string;
  sender_user_id: string;
  body: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  slot_id: string;
  patient_profile_id: string;
  clinician_id: string;
  starts_at: string;
  duration_minutes: number;
  modality: string;
  status: string;
  reason: string | null;
}

export interface InvestigationOrder {
  id: string;
  care_thread_id: string;
  patient_profile_id: string;
  investigation_code: string;
  investigation_type: string;
  urgency: string;
  status: string;
  is_critical: boolean;
  narrative: string | null;
  ordered_at: string;
  resulted_at: string | null;
  values: {
    analyte: string;
    value: string;
    unit: string | null;
    reference_low: number | null;
    reference_high: number | null;
    flag: string;
  }[];
}

export interface Discussion {
  id: string;
  community_id: string;
  title: string;
  body: string;
  author_clinician_id: string;
  is_case_discussion: boolean;
  reply_count: number;
  created_at: string;
}

export interface SecondOpinion {
  id: string;
  care_thread_id: string;
  specialty: string;
  question: string;
  answer: string | null;
  status: 'open' | 'claimed' | 'answered' | 'withdrawn';
  requested_at: string;
  answered_at: string | null;
}

export type DeclineReason = 'out_of_specialty' | 'language_mismatch' | 'at_capacity' | 'other';

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
  user_id?: string;
  facility_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  account_status?: string;
  license_number: string;
  specialty: string;
  verification_status: 'pending' | 'verified' | 'rejected' | 'suspended';
  rejection_reason?: string | null;
  languages_spoken?: string[];
  is_available: boolean;
  available_until?: string | null;
  current_load?: number;
  rating_avg?: number | null;
  version?: number;
  updated_at?: string;
  created_at?: string;
}

export interface ClinicianDirectoryEntry {
  id: string;
  full_name: string | null;
  specialty: string;
  status: 'available' | 'busy' | 'off_duty';
  queue_count: number;
  license_number?: string;
  verification_status?: 'pending' | 'verified' | 'rejected' | 'suspended';
  facility_id?: string | null;
  is_available?: boolean;
}

export type GeoLevel = 'ward' | 'district' | 'region' | 'national' | 'continental';

export interface ConditionCount {
  condition_code: string;
  condition_name: string;
  count: number;
  rate_per_100k: number | null;
  rank?: number;
  change_percent: number | null;
}

export interface TrendPoint {
  period: string;
  count: number;
  expected_low: number | null;
  expected_high: number | null;
  above_expected: boolean;
}

export interface TrendSeries {
  condition_code: string;
  level: GeoLevel;
  area_code: string | null;
  points: TrendPoint[];
  model_version: string | null;
}

export interface ResearchDataset {
  id: string;
  name: string;
  description: string;
  deidentification_method: string;
  k_anonymity: number;
  minimum_cell_size: number;
  requires_ethics_approval: boolean;
  record_count: number;
}

export interface ResearchQuery {
  id: string;
  dataset_id: string;
  ethics_approval_ref: string;
  query: { measure: string; group_by: string[] };
  status: 'queued' | 'running' | 'complete' | 'failed' | 'rejected';
  rows: Record<string, unknown>[];
  suppressed_cells: number;
  submitted_at: string;
  completed_at: string | null;
}

export interface PatientProfile {
  id: string;
  user_id?: string | null;
  guardian_user_id?: string | null;
  full_name?: string;
  date_of_birth?: string;
  sex?: string;
  chronic_conditions?: string[];
  allergies?: string[];
  blood_type?: string | null;
  region_code?: string;
  version: number;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  role: string;
  status: string;
  full_name?: string | null;
  phone_number?: string;
  email?: string | null;
  preferred_language: string;
  patient_profile?: PatientProfile;
  version: number;
  updated_at: string;
}

export interface CareThread {
  id: string;
  patient_profile_id: string;
  primary_clinician_id: string | null;
  status: string;
  reason_summary?: string | null;
  latest_consultation_id: string | null;
  open_consultation_count: number;
  active_follow_up_cycle_id: string | null;
  opened_at: string;
  closed_at: string | null;
  outcome: string | null;
  version: number;
  updated_at: string;
}

export interface CheckIn {
  id: string;
  follow_up_cycle_id: string;
  care_thread_id?: string;
  scheduled_at: string;
  status: 'scheduled' | 'responded' | 'missed';
  questions?: Record<string, unknown>[];
  responses?: Record<string, unknown> | null;
  is_deviation?: boolean;
  deviation_reasons?: string[];
  responded_at?: string | null;
}

export interface Prescription {
  id: string;
  care_thread_id: string;
  consultation_id?: string;
  patient_profile_id: string;
  status: string;
  adherence_rate?: number | null;
  items: { id: string; medication_name: string; dosage: string; frequency_per_day: number; duration_days: number; instructions?: string | null }[];
  created_at?: string;
  updated_at: string;
}

export interface AdherenceLog {
  id: string;
  prescription_item_id: string;
  prescription_id?: string;
  patient_profile_id?: string;
  medication_name?: string;
  dosage?: string;
  scheduled_at: string;
  reported_status: 'taken' | 'missed' | 'delayed' | 'unreported';
  reported_at: string | null;
  note?: string | null;
}
