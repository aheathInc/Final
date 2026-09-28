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
