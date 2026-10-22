/** Administrative navigation, NOT diagnosis, triage or an AI model. */
export type VisitStatus = 'preregistered' | 'awaiting_review' | 'waiting' | 'called' | 'in_consultation' | 'completed' | 'cancelled';
export type AdministrativeCheck = 'pending' | 'manually_verified' | 'not_required';
export type TriageStatus = 'pending' | 'cleared' | 'escalated';
export type VisitAction = 'check-in' | 'administrative-review' | 'clinical-review' | 'call' | 'start' | 'cancel';

export interface Readiness {
  checkedInAt: Date | null;
  administrativeAt: Date | null;
  triageStatus: TriageStatus;
  paymentRequired: boolean;
  insuranceRequired: boolean;
  paymentCheck: AdministrativeCheck;
  insuranceCheck: AdministrativeCheck;
}

export const ACTIVE_VISIT_STATUSES: VisitStatus[] = [
  'preregistered', 'awaiting_review', 'waiting', 'called', 'in_consultation',
];
export const REVIEW_STATES: VisitStatus[] = ['preregistered', 'awaiting_review'];

export function administrativeCheckSatisfied(required: boolean, check: AdministrativeCheck): boolean {
  return check === 'manually_verified' || (!required && check === 'not_required');
}

export function isReadyForQueue(visit: Readiness): boolean {
  return visit.checkedInAt !== null && visit.administrativeAt !== null && visit.triageStatus === 'cleared'
    && administrativeCheckSatisfied(visit.paymentRequired, visit.paymentCheck)
    && administrativeCheckSatisfied(visit.insuranceRequired, visit.insuranceCheck);
}

/** Called only while preregistered or awaiting_review, never rewinds clinical care. */
export function readinessStatus(visit: Readiness): VisitStatus {
  if (!visit.checkedInAt) return 'preregistered';
  return isReadyForQueue(visit) ? 'waiting' : 'awaiting_review';
}

export function actionAllowed(status: VisitStatus, action: VisitAction): boolean {
  switch (action) {
    case 'check-in': return status === 'preregistered';
    case 'administrative-review':
    case 'clinical-review': return REVIEW_STATES.includes(status);
    case 'call': return status === 'waiting';
    case 'start': return status === 'called';
    case 'cancel': return ['preregistered', 'awaiting_review', 'waiting', 'called'].includes(status);
  }
}

export function clinicianReceiving(
  clinician: { isAvailable: boolean; availableUntil: Date | null; verificationStatus: string; user: { status: string; role: string } },
  now: Date,
): boolean {
  return clinician.verificationStatus === 'verified' && clinician.user.status === 'active'
    && clinician.user.role === 'clinician' && clinician.isAvailable
    && (clinician.availableUntil === null || clinician.availableUntil > now);
}

function normalise(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export interface DirectoryDepartment { id: string; name: string; navigationAliases: unknown; }
/**
 * Only matches explicit facility-maintained directory terms. No inferred
 * specialty, urgency score, treatment advice, remote LLM or demographic data.
 * More than one candidate means the patient must choose, not silent routing.
 */
export function suggestDepartments(text: string, departments: DirectoryDepartment[]) {
  const words = ` ${normalise(text)} `;
  const suggestions = departments.flatMap((department) => {
    const aliases = Array.isArray(department.navigationAliases)
      ? department.navigationAliases.filter((term): term is string => typeof term === 'string') : [];
    const terms = [department.name, ...aliases].map(normalise).filter(Boolean);
    return terms.some((term) => words.includes(` ${term} `))
      ? [{ department_id: department.id, department_name: department.name, basis: 'facility_directory_term' as const }] : [];
  });
  return {
    mode: 'directory_navigation' as const,
    outcome: suggestions.length === 0 ? 'manual_selection_required' : suggestions.length === 1 ? 'suggestion_available' : 'multiple_matches',
    suggestions,
    patient_confirmation_required: true as const,
    clinical_triage_performed: false as const,
  };
}

/** The FIFO position is scoped to one administrative pool, not a wait-time promise. */
export function waitingPool(visit: { facilityId: string; departmentId: string; requestedClinicianId: string | null }) {
  return { facilityId: visit.facilityId, departmentId: visit.departmentId, requestedClinicianId: visit.requestedClinicianId, status: 'waiting' as const };
}

export function queueAheadWhere(visit: { id: string; facilityId: string; departmentId: string; requestedClinicianId: string | null; readyAt: Date | null }) {
  if (!visit.readyAt) throw new Error('Waiting visits require a ready timestamp');
  return {
    ...waitingPool(visit),
    OR: [{ readyAt: { lt: visit.readyAt } }, { readyAt: visit.readyAt, id: { lt: visit.id } }],
  };
}
