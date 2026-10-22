export type DeskStatus = 'preregistered' | 'awaiting_review' | 'waiting' | 'called' | 'in_consultation' | 'completed' | 'cancelled';
export interface DeskFacility {
  id: string; name: string; version: number; enabled: boolean;
  payment_required: boolean; insurance_required: boolean;
}
export interface DeskDepartment { id: string; name: string; version: number; navigation_aliases?: string[]; }
export interface DeskVisit {
  id: string; ticket: string; status: DeskStatus; version: number;
  patient_name: string; purpose?: string;
  facility: { id: string; name: string }; department: { id: string; name: string };
  requested_clinician: { id: string; name: string | null } | null;
  assigned_clinician: { id: string; name: string | null } | null;
  consultation_id: string | null; care_thread_id: string | null;
  requirements: { payment: boolean; insurance: boolean; clinical_review: boolean };
  clearance: { registration: string; payment: string; insurance: string; clinical_review: string; method: string };
  checked_in_at: string | null; ready_at: string | null; created_at: string;
}
export const deskStatusLabels: Record<DeskStatus, string> = {
  preregistered: 'Pre-registered — arrival not declared', awaiting_review: 'Awaiting facility review',
  waiting: 'Waiting for clinician', called: 'Called by clinician', in_consultation: 'Consultation started',
  completed: 'Consultation completed', cancelled: 'Visit cancelled',
};
