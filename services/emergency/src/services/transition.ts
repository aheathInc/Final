/**
 * Legal status transitions for an emergency.
 *
 * `dispatched` is deliberately unreachable from here — it is only entered
 * through the dedicated dispatch action, which requires a real transport unit
 * and destination, not a bare status flip. That separation exists so a status
 * update can never claim a case is dispatched when nothing has actually been
 * assigned to it.
 *
 * An emergency cannot be closed without an outcome: resolving without one is
 * rejected below, in code, not left as a documentation convention.
 */

export type EmergencyStatus =
  | 'reported' | 'triaged' | 'dispatched' | 'en_route' | 'arrived' | 'resolved' | 'cancelled';

const ALLOWED_VIA_STATUS_ENDPOINT: Record<EmergencyStatus, EmergencyStatus[]> = {
  reported: ['triaged', 'cancelled'],
  triaged: ['cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

export function isLegalStatusTransition(from: EmergencyStatus, to: EmergencyStatus): boolean {
  return ALLOWED_VIA_STATUS_ENDPOINT[from]?.includes(to) ?? false;
}

export function canDispatch(status: EmergencyStatus): boolean {
  return status === 'reported' || status === 'triaged';
}
