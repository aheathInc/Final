import type { Urgency } from './api';

/**
 * The colour rule, in one place so it cannot drift between screens.
 *
 * Routine gets a neutral line rather than an accent. That is deliberate: in a
 * list of twenty, the rows carrying colour are the ones that cannot wait.
 * Give every row an accent and the list tells you nothing.
 */
export function urgencyStyle(level: Urgency) {
  switch (level) {
    case 'emergency':
      return { border: 'border-l-4 border-clay', label: 'Emergency', text: 'text-clay' };
    case 'urgent':
      return { border: 'border-l-4 border-amber', label: 'Urgent', text: 'text-amber' };
    default:
      return { border: 'border-l-4 border-line', label: 'Routine', text: 'text-ink-soft' };
  }
}

/** A lab flag means the same thing as a triage level: how fast must someone look. */
export function flagStyle(flag: string) {
  if (flag === 'critical_low' || flag === 'critical_high') {
    return { text: 'text-clay font-semibold', label: 'Critical' };
  }
  if (flag === 'low' || flag === 'high') {
    return { text: 'text-amber', label: flag === 'low' ? 'Low' : 'High' };
  }
  return { text: 'text-ink-soft', label: 'Normal' };
}
