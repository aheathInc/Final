/**
 * Computes a result's flag from its numeric value and bounds.
 *
 * This is the mechanism that actually closes the blueprint's "late
 * pathology discovery" gap: a critical result must escalate on its own,
 * because a discovery nobody looked at is not a discovery. The flag is
 * always computed here, from server-held bounds — never accepted as a
 * client-supplied field, for the same reason a check-in's is_deviation is
 * never trusted from the client: a patient's phone (or, here, whoever is
 * filing the result) deciding whether their own result looks critical
 * would defeat the point of having a threshold at all.
 *
 * Reference range and critical range are two different clinical concepts.
 * A potassium of 5.6 might be flagged high against the reference range
 * (3.5–5.0) without yet being the critical value (6.5) that demands
 * immediate action — the two bounds are evaluated independently, and
 * critical always wins when both apply.
 *
 * Non-numeric values (a qualitative "positive"/"negative" pathology result)
 * cannot be evaluated by this function and are flagged `normal` by default
 * — a documented limitation, not a silent gap: introducing a client-trusted
 * flag for the unparseable case would reopen exactly the trust hole this
 * exists to close.
 */

export type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

export interface FlagInput {
  value: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export function computeFlag(input: FlagInput): ResultFlag {
  const numeric = Number(input.value);
  if (Number.isNaN(numeric)) return 'normal';

  if (input.criticalLow !== undefined && numeric <= input.criticalLow) return 'critical_low';
  if (input.criticalHigh !== undefined && numeric >= input.criticalHigh) return 'critical_high';
  if (input.referenceLow !== undefined && numeric < input.referenceLow) return 'low';
  if (input.referenceHigh !== undefined && numeric > input.referenceHigh) return 'high';
  return 'normal';
}

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === 'critical_low' || flag === 'critical_high';
}
