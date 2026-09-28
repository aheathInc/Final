/**
 * Evaluates a check-in response against the cycle's recovery_criteria.
 *
 * This is the guard the whole check-in system exists to enforce: `is_deviation`
 * is computed here, from server-held criteria, never accepted from the client.
 * A patient's phone deciding whether their own recovery looks normal would
 * defeat the point of asking a clinician to set the threshold.
 *
 * Deliberately permissive about shape: recovery_criteria is clinician-authored
 * JSON, and a criterion this evaluator does not recognise is skipped rather
 * than treated as a match. Silently ignoring an unknown criterion is safer
 * than silently passing a check that was never actually evaluated.
 */

export interface DeviationCriteria {
  vital_bounds?: Record<string, { min?: number; max?: number }>;
  red_flag_fields?: string[];
  concerning_phrases?: Record<string, string[]>;
  no_decline_below?: Record<string, number>;
}

export interface DeviationResult {
  isDeviation: boolean;
  reasons: string[];
}

export function evaluateDeviation(
  responses: Record<string, unknown>,
  criteria: DeviationCriteria,
): DeviationResult {
  const reasons: string[] = [];

  for (const [field, bounds] of Object.entries(criteria.vital_bounds ?? {})) {
    const value = responses[field];
    if (typeof value !== 'number') continue;
    if (bounds.min !== undefined && value < bounds.min) {
      reasons.push(field + '=' + value + ' below minimum ' + bounds.min);
    }
    if (bounds.max !== undefined && value > bounds.max) {
      reasons.push(field + '=' + value + ' above maximum ' + bounds.max);
    }
  }

  for (const field of criteria.red_flag_fields ?? []) {
    if (responses[field] === true) {
      reasons.push(field + ' reported true');
    }
  }

  for (const [field, phrases] of Object.entries(criteria.concerning_phrases ?? {})) {
    const value = responses[field];
    if (typeof value !== 'string') continue;
    const lower = value.toLowerCase();
    for (const phrase of phrases) {
      if (lower.includes(phrase.toLowerCase())) {
        reasons.push(field + ' mentions "' + phrase + '"');
        break;
      }
    }
  }

  for (const [field, minimum] of Object.entries(criteria.no_decline_below ?? {})) {
    const value = responses[field];
    if (typeof value === 'number' && value < minimum) {
      reasons.push(field + '=' + value + ' below required ' + minimum);
    }
  }

  return { isDeviation: reasons.length > 0, reasons };
}
