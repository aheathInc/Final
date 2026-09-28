import type { Urgency } from './triage.js';

/**
 * The shape an administrator may edit. Everything here is data; nothing here
 * can change the floor below.
 */
export interface TriageRules {
  redFlags: Record<string, string>;
  obstetricRedFlags: Record<string, string>;
  urgentCodes: Record<string, string>;
  specialtyHints: Record<string, string>;
  severityUrgentThreshold: number;
  infantFeverMaxAgeYears: number;
  underFiveMaxAgeYears: number;
  elderlyMinAgeYears: number;
  paediatricMaxAgeYears: number;
  chronicRaising: string[];
}

export interface SlaWindows {
  emergency: number;
  urgent: number;
  routine: number;
}

export interface Ruleset {
  label: string;
  rules: TriageRules;
  sla: SlaWindows;
}

/**
 * Presentations that must always be an emergency, whatever a published
 * ruleset says.
 *
 * This list is in code on purpose. A configuration screen that could demote a
 * stroke would turn one bad afternoon — or one stolen admin session — into a
 * patient who waited two hours for a routine slot. Everything else about
 * triage is editable; this is the part that is not.
 */
export const NON_NEGOTIABLE_EMERGENCY: Record<string, string> = {
  chest_pain: 'FLOOR-CARDIAC',
  breathing_difficulty: 'FLOOR-RESP',
  one_sided_weakness: 'FLOOR-STROKE',
  speech_difficulty: 'FLOOR-STROKE',
  facial_droop: 'FLOOR-STROKE',
  severe_bleeding: 'FLOOR-HAEM',
  unconscious: 'FLOOR-NEURO',
  seizure: 'FLOOR-NEURO',
  poisoning: 'FLOOR-TOX',
  suicidal_ideation: 'FLOOR-MH',
  neck_stiffness_fever: 'FLOOR-MENING',
};

/** Obstetric floor: only when pregnancy is known, since the codes are specific to it. */
export const NON_NEGOTIABLE_OBSTETRIC: Record<string, string> = {
  vaginal_bleeding_pregnancy: 'FLOOR-OBS-BLEED',
  reduced_fetal_movement: 'FLOOR-OBS-FETAL',
};

/**
 * Outer bounds on the SLA windows. An administrator may tighten these freely;
 * they may not loosen them past the point where the level stops meaning
 * anything. An "emergency" nobody must answer for a day is not an emergency.
 */
export const SLA_BOUNDS: Record<Urgency, { min: number; max: number }> = {
  emergency: { min: 60, max: 900 },
  urgent: { min: 300, max: 7200 },
  routine: { min: 900, max: 86_400 },
};

/**
 * The rules the platform ships with — the same ones that were previously
 * hardcoded. Seeded as the first active version so the system behaves
 * identically on the day this lands.
 */
export const DEFAULT_RULES: TriageRules = {
  redFlags: {
    chest_pain: 'RF-CARDIAC-01',
    breathing_difficulty: 'RF-RESP-01',
    one_sided_weakness: 'RF-STROKE-01',
    speech_difficulty: 'RF-STROKE-02',
    facial_droop: 'RF-STROKE-03',
    severe_bleeding: 'RF-HAEM-01',
    unconscious: 'RF-NEURO-01',
    seizure: 'RF-NEURO-02',
    severe_abdominal_pain: 'RF-ABDO-01',
    poisoning: 'RF-TOX-01',
    severe_burn: 'RF-BURN-01',
    suicidal_ideation: 'RF-MH-01',
    neck_stiffness_fever: 'RF-MENING-01',
  },
  obstetricRedFlags: {
    vaginal_bleeding_pregnancy: 'RF-OBS-01',
    reduced_fetal_movement: 'RF-OBS-02',
    severe_headache_pregnancy: 'RF-OBS-03',
    labour_pains: 'RF-OBS-04',
  },
  urgentCodes: {
    high_fever: 'UR-FEVER-01',
    persistent_vomiting: 'UR-GI-01',
    dehydration: 'UR-GI-02',
    moderate_bleeding: 'UR-HAEM-02',
    eye_injury: 'UR-EYE-01',
    fracture_suspected: 'UR-MSK-01',
    severe_pain: 'UR-PAIN-01',
    infant_fever: 'UR-PAED-01',
  },
  specialtyHints: {
    chest_pain: 'internal_medicine',
    breathing_difficulty: 'internal_medicine',
    one_sided_weakness: 'internal_medicine',
    vaginal_bleeding_pregnancy: 'obstetrics_gynaecology',
    reduced_fetal_movement: 'obstetrics_gynaecology',
    labour_pains: 'obstetrics_gynaecology',
    severe_headache_pregnancy: 'obstetrics_gynaecology',
    suicidal_ideation: 'psychiatry',
    rash: 'dermatology',
    fracture_suspected: 'surgery',
    severe_abdominal_pain: 'surgery',
  },
  severityUrgentThreshold: 8,
  infantFeverMaxAgeYears: 1,
  underFiveMaxAgeYears: 5,
  elderlyMinAgeYears: 65,
  paediatricMaxAgeYears: 16,
  chronicRaising: [
    'diabetes', 'hiv', 'tuberculosis', 'heart_failure',
    'chronic_kidney_disease', 'sickle_cell',
  ],
};

export const DEFAULT_SLA: SlaWindows = { emergency: 180, urgent: 900, routine: 7200 };
export const DEFAULT_LABEL = '2026.08.1';

/**
 * Structural validation. Returns every problem rather than the first, because
 * an administrator fixing one field at a time through a form is a slow way to
 * discover four mistakes.
 */
export function validateRules(rules: unknown): string[] {
  const errors: string[] = [];
  const r = rules as Partial<TriageRules> | null;
  if (!r || typeof r !== 'object') return ['rules must be an object'];

  for (const key of ['redFlags', 'obstetricRedFlags', 'urgentCodes', 'specialtyHints'] as const) {
    const v = r[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      errors.push(`${key} must be an object of code -> label`);
      continue;
    }
    for (const [code, label] of Object.entries(v)) {
      if (!/^[a-z0-9_]+$/.test(code)) errors.push(`${key}: "${code}" is not a valid symptom code`);
      if (typeof label !== 'string' || !label) errors.push(`${key}.${code} needs a non-empty label`);
    }
  }

  const numbers: [keyof TriageRules, number, number][] = [
    ['severityUrgentThreshold', 1, 10],
    ['infantFeverMaxAgeYears', 0, 5],
    ['underFiveMaxAgeYears', 1, 18],
    ['elderlyMinAgeYears', 50, 120],
    ['paediatricMaxAgeYears', 1, 21],
  ];
  for (const [key, min, max] of numbers) {
    const v = r[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      errors.push(`${String(key)} must be a number between ${min} and ${max}`);
    }
  }

  if (!Array.isArray(r.chronicRaising) || r.chronicRaising.some((c) => typeof c !== 'string')) {
    errors.push('chronicRaising must be a list of condition codes');
  }
  return errors;
}

export function validateSla(sla: unknown): string[] {
  const errors: string[] = [];
  const s = sla as Partial<SlaWindows> | null;
  if (!s || typeof s !== 'object') return ['sla must be an object'];

  for (const level of ['emergency', 'urgent', 'routine'] as Urgency[]) {
    const v = s[level];
    const bound = SLA_BOUNDS[level];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`sla.${level} must be a number of seconds`);
    } else if (v < bound.min || v > bound.max) {
      errors.push(
        `sla.${level} must be between ${bound.min} and ${bound.max} seconds — ` +
          `outside that range the level stops meaning what it says`,
      );
    }
  }

  // Ordering matters as much as the individual values: an urgent case that may
  // wait longer than a routine one is a queue that will surprise someone.
  if (typeof s.emergency === 'number' && typeof s.urgent === 'number' && s.emergency >= s.urgent) {
    errors.push('sla.emergency must be shorter than sla.urgent');
  }
  if (typeof s.urgent === 'number' && typeof s.routine === 'number' && s.urgent >= s.routine) {
    errors.push('sla.urgent must be shorter than sla.routine');
  }
  return errors;
}
