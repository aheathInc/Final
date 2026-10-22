import type { EmergencyStatus } from './api';

/**
 * How an emergency may move, mirroring exactly what the backend permits.
 *
 * `dispatched` is absent on purpose: it is reachable only through the dispatch
 * action, which requires a real transport unit and a destination. A status
 * dropdown that could set it would let the board claim a crew is on the way
 * when nothing has been assigned — a false state more dangerous than no state.
 */
const NEXT: Record<EmergencyStatus, EmergencyStatus[]> = {
  reported: ['triaged', 'cancelled'],
  triaged: ['cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

export function nextStatuses(from: EmergencyStatus): EmergencyStatus[] {
  return NEXT[from] ?? [];
}

export function canDispatch(status: EmergencyStatus): boolean {
  return status === 'reported' || status === 'triaged';
}

export const STATUS_LABEL: Record<EmergencyStatus, string> = {
  reported: 'Imeripotiwa',
  triaged: 'Imepangwa',
  dispatched: 'Gari limetumwa',
  en_route: 'Njiani',
  arrived: 'Wamefika',
  resolved: 'Imekamilika',
  cancelled: 'Imeghairiwa',
};

/**
 * Scale, not status, drives the accent: a mass casualty event outranks
 * everything on the board regardless of how far along it is.
 */
export function emergencyAccent(e: { scale: string; status: EmergencyStatus }): string {
  if (e.status === 'resolved' || e.status === 'cancelled') return 'border border-line';
  if (e.scale === 'mass_casualty') return 'border-l-4 border-clay';
  if (e.status === 'reported' || e.status === 'triaged') return 'border-l-4 border-amber';
  return 'border-l-4 border-petrol';
}
