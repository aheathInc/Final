/**
 * Deterministic triage. Same input, same ruleset, same answer, always.
 *
 * Determinism is not a style preference: a triage decision has to be
 * explainable months later against the exact rules that were live when it was
 * made. That is why the ruleset label is stamped onto every consultation, and
 * why nothing in this file reads a clock, a database, or a model.
 *
 * The rules are now data rather than constants (FR-AD-03), but the shape of
 * this function did not change: it is still pure, and it still cannot reach
 * outside its arguments.
 */
import {
  NON_NEGOTIABLE_EMERGENCY,
  NON_NEGOTIABLE_OBSTETRIC,
  type Ruleset,
  type SlaWindows,
  type TriageRules,
} from './ruleset.js';

export type Urgency = 'routine' | 'urgent' | 'emergency';

export interface TriageInput {
  symptomCodes: string[];
  severityByCode?: Record<string, number>;
  durationHoursByCode?: Record<string, number>;
  freeText?: string;
  ageYears?: number | null;
  isPregnant?: boolean;
  chronicConditions?: string[];
}

export interface TriageResult {
  urgency: Urgency;
  matchedRules: string[];
  recommendedSpecialty: string;
  ruleVersion: string;
}

const rankOf: Record<Urgency, number> = { routine: 0, urgent: 1, emergency: 2 };
const raise = (a: Urgency, b: Urgency): Urgency => (rankOf[b] > rankOf[a] ? b : a);

/**
 * Applies the floor after the ruleset has had its say.
 *
 * Running it last rather than first is what makes it a floor rather than a
 * shortcut: a published ruleset is free to raise anything it likes, and free
 * to add codes of its own, but it cannot lower one of these below emergency.
 */
function applyFloor(
  codes: string[],
  isPregnant: boolean | undefined,
  urgency: Urgency,
  matched: string[],
): Urgency {
  let result = urgency;
  for (const code of codes) {
    if (NON_NEGOTIABLE_EMERGENCY[code]) {
      if (result !== 'emergency') matched.push(NON_NEGOTIABLE_EMERGENCY[code]);
      result = 'emergency';
    }
    if (isPregnant && NON_NEGOTIABLE_OBSTETRIC[code]) {
      if (result !== 'emergency') matched.push(NON_NEGOTIABLE_OBSTETRIC[code]);
      result = 'emergency';
    }
  }
  return result;
}

export function triageWith(input: TriageInput, ruleset: Ruleset): TriageResult {
  const rules: TriageRules = ruleset.rules;
  const codes = input.symptomCodes.map((c) => c.toLowerCase());
  const matched: string[] = [];
  let urgency: Urgency = 'routine';
  let specialty = 'general_practice';

  for (const code of codes) {
    if (rules.redFlags[code]) {
      matched.push(rules.redFlags[code]);
      urgency = raise(urgency, 'emergency');
    }
    if (input.isPregnant && rules.obstetricRedFlags[code]) {
      matched.push(rules.obstetricRedFlags[code]);
      urgency = raise(urgency, 'emergency');
    }
    if (rules.urgentCodes[code]) {
      matched.push(rules.urgentCodes[code]);
      urgency = raise(urgency, 'urgent');
    }
    if (rules.specialtyHints[code] && specialty === 'general_practice') {
      specialty = rules.specialtyHints[code];
    }
  }

  // Severity at the top of the scale is urgent whatever it attaches to. A
  // patient calling their pain ten out of ten is information, not noise.
  for (const [code, severity] of Object.entries(input.severityByCode ?? {})) {
    if (severity >= rules.severityUrgentThreshold) {
      matched.push('SEV-HIGH:' + code);
      urgency = raise(urgency, 'urgent');
    }
  }

  // The very young and the very old decompensate faster and declare it later.
  const age = input.ageYears;
  if (age !== null && age !== undefined) {
    if (age < rules.infantFeverMaxAgeYears && (codes.includes('fever') || codes.includes('high_fever'))) {
      matched.push('AGE-INFANT-FEVER');
      urgency = raise(urgency, 'emergency');
    } else if (age < rules.underFiveMaxAgeYears && urgency === 'routine' && codes.length > 0) {
      matched.push('AGE-UNDER-5');
      urgency = raise(urgency, 'urgent');
    }
    if (age >= rules.elderlyMinAgeYears && urgency === 'routine' && codes.length > 0) {
      matched.push('AGE-OVER-65');
      urgency = raise(urgency, 'urgent');
    }
    // Deliberately not guarded on general_practice: a child's rash belongs to
    // a paediatrician, not a dermatologist, so age overrides a symptom hint.
    // Obstetric routing is assigned after this block and still wins, which is
    // why a pregnant patient is never sent to paediatrics.
    if (age < rules.paediatricMaxAgeYears) {
      specialty = 'paediatrics';
    }
  }

  // A chronic condition turns an ordinary complaint into a different problem.
  const chronic = (input.chronicConditions ?? []).map((c) => c.toLowerCase());
  if (chronic.some((c) => rules.chronicRaising.includes(c)) && urgency === 'routine' && codes.length > 0) {
    matched.push('CHRONIC-MODIFIER');
    urgency = raise(urgency, 'urgent');
  }

  if (input.isPregnant && specialty === 'general_practice') {
    specialty = 'obstetrics_gynaecology';
  }

  urgency = applyFloor(codes, input.isPregnant, urgency, matched);

  return {
    urgency,
    matchedRules: [...new Set(matched)],
    recommendedSpecialty: specialty,
    ruleVersion: ruleset.label,
  };
}

export function slaSecondsFor(urgency: Urgency, sla: SlaWindows): number {
  if (urgency === 'emergency') return sla.emergency;
  if (urgency === 'urgent') return sla.urgent;
  return sla.routine;
}
