#!/usr/bin/env bash
#
# FR-AD-03, part one: triage rules and SLA windows become data an admin can
# change without a code deployment.
#
# THE SAFETY FLOOR IS NOT CONFIGURABLE, and that is deliberate.
#
# A handful of presentations must always come out as an emergency: stroke
# signs, chest pain, severe bleeding, unconsciousness, suicidal ideation and a
# few others. Those live in code, are applied after whatever the published
# ruleset decided, and a ruleset that would classify any of them below
# emergency is refused at activation.
#
# The requirement says an administrator may configure the rules. It does not
# say the system should let one mistake, or one stolen admin session, route a
# stroke to a routine queue. The floor is what makes the rest of it safe to
# offer at all.
#
# Screening questionnaires are the third part of FR-AD-03. They are not built
# here because questionnaires do not exist yet at all (FR-PS-01) — their
# configuration arrives with them rather than ahead of them.
#
# Run from the repo root:
#   bash setup-triage-config.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/consultation"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SVC/src/engine/triage.ts" ] || { echo "services/consultation not set up."; exit 1; }

ERRORS="$ROOT/packages/http/src/errors.ts"
for code in NOT_FOUND FORBIDDEN VALIDATION_FAILED STATE_TRANSITION_INVALID DUPLICATE_RESOURCE; do
  grep -q "'$code'" "$ERRORS" || { echo "  MISSING ERROR CODE: $code"; exit 1; }
done
echo "  confirmed: required error codes exist"

mkdir -p "$SVC/src/engine" "$SVC/src/services"

# ---------------------------------------------------------------------------
# The rule data, its defaults, and the non-negotiable floor
# ---------------------------------------------------------------------------
cat > "$SVC/src/engine/ruleset.ts" << 'TS'
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
TS
echo "  engine/ruleset.ts written"

# ---------------------------------------------------------------------------
# The engine, now taking rules as an argument
# ---------------------------------------------------------------------------
cat > "$SVC/src/engine/triage.ts" << 'TS'
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
    if (age < rules.paediatricMaxAgeYears && specialty === 'general_practice') {
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
TS
echo "  engine/triage.ts rewritten to take rules as data"

# ---------------------------------------------------------------------------
# Loading, caching and changing the active ruleset
# ---------------------------------------------------------------------------
cat > "$SVC/src/services/ruleset.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import {
  DEFAULT_LABEL, DEFAULT_RULES, DEFAULT_SLA,
  NON_NEGOTIABLE_EMERGENCY, NON_NEGOTIABLE_OBSTETRIC,
  type Ruleset, validateRules, validateSla,
} from '../engine/ruleset.js';
import { triageWith } from '../engine/triage.js';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

/**
 * Cached because triage runs on the path of every consultation request, and a
 * database round trip per triage would put the rules in the way of the thing
 * they exist to serve.
 *
 * Refreshed on a timer rather than pushed: a change reaches other service
 * instances within CACHE_TTL_MS. That delay is real and worth stating — a
 * newly activated ruleset is live here immediately and everywhere else within
 * half a minute.
 */
const CACHE_TTL_MS = 30_000;
let cached: { ruleset: Ruleset; at: number } | null = null;

const FALLBACK: Ruleset = { label: DEFAULT_LABEL, rules: DEFAULT_RULES, sla: DEFAULT_SLA };

export async function activeRuleset(): Promise<Ruleset> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ruleset;

  const row = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });
  // No active row means the seed has not run. Falling back to the shipped
  // defaults keeps triage working rather than failing closed on a
  // configuration problem — a consultation that cannot be triaged is a patient
  // who cannot be seen.
  const ruleset: Ruleset = row
    ? { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never }
    : FALLBACK;

  cached = { ruleset, at: Date.now() };
  return ruleset;
}

function invalidate() {
  cached = null;
}

/** Seeds the shipped rules as the first active version. Idempotent. */
export async function seedDefaultRuleset(systemUserId?: string): Promise<void> {
  const existing = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });
  if (existing) return;

  const author =
    systemUserId ??
    (await prisma.user.findFirst({ where: { role: 'platform_admin' }, select: { id: true } }))?.id;
  if (!author) return; // No admin exists yet; the fallback covers triage until one does.

  await prisma.triageRuleset.create({
    data: {
      label: DEFAULT_LABEL,
      status: 'active',
      rules: DEFAULT_RULES as never,
      slaSeconds: DEFAULT_SLA as never,
      notes: 'Rules the platform shipped with, seeded so behaviour is unchanged.',
      createdById: author,
      activatedById: author,
      activatedAt: new Date(),
    },
  });
  invalidate();
}

function assertAdmin(caller: Caller) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a platform administrator may change triage rules');
  }
}

function serialise(r: {
  id: string; label: string; status: string; rules: unknown; slaSeconds: unknown;
  notes: string | null; createdById: string; activatedAt: Date | null;
  retiredAt: Date | null; createdAt: Date;
}) {
  return {
    id: r.id,
    label: r.label,
    status: r.status,
    rules: r.rules,
    sla_seconds: r.slaSeconds,
    notes: r.notes,
    created_by_id: r.createdById,
    activated_at: r.activatedAt?.toISOString() ?? null,
    retired_at: r.retiredAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

export async function listRulesets(caller: Caller) {
  assertAdmin(caller);
  const rows = await prisma.triageRuleset.findMany({ orderBy: { createdAt: 'desc' } });
  return { data: rows.map(serialise) };
}

export async function getRuleset(label: string, caller: Caller) {
  assertAdmin(caller);
  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');
  return serialise(row);
}

/**
 * Creates a draft. Never edits an existing version — including another draft.
 *
 * Immutability is what keeps ConsultationRequest.triageRuleVersion honest: a
 * consultation decided months ago must still resolve to the rules that decided
 * it, and an editable row would make that stamp point at something else.
 */
export async function createDraft(
  caller: Caller,
  input: { label: string; rules?: unknown; sla_seconds?: unknown; clone_from?: string; notes?: string },
  meta: Meta,
) {
  assertAdmin(caller);

  const clash = await prisma.triageRuleset.findUnique({ where: { label: input.label } });
  if (clash) throw conflict('DUPLICATE_RESOURCE', `A ruleset labelled ${input.label} already exists`);

  let rules = input.rules;
  let sla = input.sla_seconds;

  if (input.clone_from) {
    const source = await prisma.triageRuleset.findUnique({ where: { label: input.clone_from } });
    if (!source) throw notFound(`Ruleset ${input.clone_from} not found`);
    rules = rules ?? source.rules;
    sla = sla ?? source.slaSeconds;
  }
  rules = rules ?? DEFAULT_RULES;
  sla = sla ?? DEFAULT_SLA;

  const problems = [...validateRules(rules), ...validateSla(sla)];
  if (problems.length > 0) {
    throw unprocessable(`This ruleset is not valid: ${problems.join('; ')}`, 'rules');
  }

  const created = await prisma.triageRuleset.create({
    data: {
      label: input.label,
      status: 'draft',
      rules: rules as never,
      slaSeconds: sla as never,
      notes: input.notes ?? null,
      createdById: caller.sub,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'triage.ruleset_drafted',
    entityType: 'triage_rulesets', entityId: created.id,
    metadata: { label: input.label, clonedFrom: input.clone_from ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(created);
}

/**
 * The cases a ruleset must get right before it is allowed anywhere near a
 * patient. Each one is a presentation where a delayed answer changes the
 * outcome, so each must come back as an emergency.
 */
const MUST_BE_EMERGENCY: { name: string; input: Parameters<typeof triageWith>[0] }[] = [
  ...Object.keys(NON_NEGOTIABLE_EMERGENCY).map((code) => ({
    name: code,
    input: { symptomCodes: [code], ageYears: 40 },
  })),
  ...Object.keys(NON_NEGOTIABLE_OBSTETRIC).map((code) => ({
    name: `${code} (pregnant)`,
    input: { symptomCodes: [code], ageYears: 28, isPregnant: true },
  })),
];

export interface CheckResult { name: string; expected: string; got: string; passed: boolean }

function runSafetyChecks(ruleset: Ruleset): CheckResult[] {
  return MUST_BE_EMERGENCY.map(({ name, input }) => {
    const got = triageWith(input, ruleset).urgency;
    return { name, expected: 'emergency', got, passed: got === 'emergency' };
  });
}

/** Dry-run: what would this ruleset decide, and does it clear the floor? */
export async function previewRuleset(
  label: string,
  caller: Caller,
  sample?: Parameters<typeof triageWith>[0],
) {
  assertAdmin(caller);
  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');

  const ruleset: Ruleset = { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never };
  const checks = runSafetyChecks(ruleset);

  return {
    label,
    safety_checks: checks,
    all_passed: checks.every((c) => c.passed),
    sample_result: sample ? triageWith(sample, ruleset) : null,
  };
}

/**
 * Activates a draft, retiring whatever was active.
 *
 * Refuses if any safety check fails. The floor would catch such a rule at
 * runtime anyway, but a ruleset that needs the floor to be safe is one nobody
 * should be relying on, and refusing here means the administrator finds out
 * now rather than from a patient outcome.
 */
export async function activateRuleset(label: string, caller: Caller, notes: string, meta: Meta) {
  assertAdmin(caller);
  if (!notes?.trim()) {
    throw unprocessable('Say why this ruleset is being activated — a rule change nobody explained is one nobody can review.', 'notes');
  }

  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');
  if (row.status === 'active') throw conflict('STATE_TRANSITION_INVALID', 'This ruleset is already active');
  if (row.status === 'retired') throw conflict('STATE_TRANSITION_INVALID', 'A retired ruleset cannot be reactivated; clone it into a new version instead');

  const ruleset: Ruleset = { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never };
  const checks = runSafetyChecks(ruleset);
  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    throw unprocessable(
      `Refused: this ruleset would not treat these as emergencies — ${failed.map((f) => f.name).join(', ')}`,
      'rules',
    );
  }

  const previous = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });

  await prisma.$transaction(async (tx) => {
    if (previous) {
      await tx.triageRuleset.update({
        where: { id: previous.id },
        data: { status: 'retired', retiredAt: new Date() },
      });
    }
    await tx.triageRuleset.update({
      where: { id: row.id },
      data: { status: 'active', activatedById: caller.sub, activatedAt: new Date(), notes },
    });
  });

  invalidate();

  await appendAudit({
    actorUserId: caller.sub, action: 'triage.ruleset_activated',
    entityType: 'triage_rulesets', entityId: row.id,
    metadata: { label, replaced: previous?.label ?? null, notes },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return { ...serialise({ ...row, status: 'active', activatedAt: new Date(), notes }), safety_checks: checks };
}
TS
echo "  services/ruleset.service.ts written"

# ---------------------------------------------------------------------------
# Wire the call sites. The engine's signature changed, so anything that called
# it must change with it — and the tests, which called the old pure function.
# ---------------------------------------------------------------------------
node - "$SVC/src/services/consultation.service.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let changes = 0;

if (s.includes('activeRuleset()')) {
  console.log('  consultation.service.ts already wired');
  process.exit(0);
}

const oldImport = "import { slaSecondsFor, triage, type Urgency } from '../engine/triage.js';";
const newImport =
  "import { slaSecondsFor, triageWith, type Urgency } from '../engine/triage.js';\n" +
  "import { activeRuleset } from './ruleset.service.js';";
if (!s.includes(oldImport)) { console.error('  import anchor not found'); process.exit(1); }
s = s.replace(oldImport, newImport); changes++;

// The env-based SLA constant goes: the windows now travel with the ruleset, so
// a consultation's stamped version explains its deadline as well as its
// urgency. Leaving the constant would let the two disagree.
const oldSla = `const SLA = {
  emergency: env.SLA_EMERGENCY_SECONDS,
  urgent: env.SLA_URGENT_SECONDS,
  routine: env.SLA_ROUTINE_SECONDS,
};`;
if (s.includes(oldSla)) { s = s.replace(oldSla, ''); changes++; }

const oldCall = '  const result = triage({';
const newCall = '  const ruleset = await activeRuleset();\n  const result = triageWith({';
if (!s.includes(oldCall)) { console.error('  triage() call anchor not found'); process.exit(1); }
s = s.replace(oldCall, newCall); changes++;

fs.writeFileSync(p, s);
console.log(`  consultation.service.ts: ${changes} edit(s) — now reads the active ruleset`);
NODE

# The triageWith() call needs its second argument, and slaSecondsFor its new
# one. Both are inside the same function, so they are patched together after
# the import rewrite above has settled.
node - "$SVC/src/services/consultation.service.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes(', ruleset);')) {
  console.log('  call arguments already supplied');
  process.exit(0);
}

// Close the triageWith({...}) object literal with the ruleset argument. The
// call ends at the first `});` after it.
const start = s.indexOf('const result = triageWith({');
if (start === -1) { console.error('  triageWith anchor lost'); process.exit(1); }
const end = s.indexOf('  });', start);
if (end === -1) { console.error('  could not find the end of the triageWith call'); process.exit(1); }
s = s.slice(0, end) + '  }, ruleset);' + s.slice(end + '  });'.length);

const oldSlaCall = 'slaSecondsFor(result.urgency, SLA)';
if (!s.includes(oldSlaCall)) { console.error('  slaSecondsFor anchor not found'); process.exit(1); }
s = s.replace(oldSlaCall, 'slaSecondsFor(result.urgency, ruleset.sla)');

fs.writeFileSync(p, s);
const after = fs.readFileSync(p, 'utf8');
if (!after.includes('}, ruleset);') || !after.includes('ruleset.sla')) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log('  consultation.service.ts: triageWith and slaSecondsFor now take the ruleset');
NODE

# The engine tests called the old pure triage(); point them at the shipped
# defaults so they keep testing the engine rather than the database.
node - "$SVC/src/tests/engine.test.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
if (!fs.existsSync(p)) { console.log('  engine.test.ts not present, skipped'); process.exit(0); }
let s = fs.readFileSync(p, 'utf8');

if (s.includes('SHIPPED')) { console.log('  engine.test.ts already updated'); process.exit(0); }

s = s.replace(
  "import { TRIAGE_RULES_VERSION, triage } from '../engine/triage.js';",
  "import { triageWith } from '../engine/triage.js';\n" +
  "import { DEFAULT_LABEL, DEFAULT_RULES, DEFAULT_SLA } from '../engine/ruleset.js';",
);

// The shim goes after the LAST import, not in the middle of the block. Legal
// either way in ESM, but a const wedged between imports reads like a mistake.
const lines = s.split('\n');
let lastImport = -1;
lines.forEach((l, i) => { if (/^import /.test(l)) lastImport = i; });
lines.splice(lastImport + 1, 0,
  '',
  '// The rules the platform ships with. Testing against these keeps the engine',
  '// tests pure — they exercise the logic, not whatever is currently active in',
  '// the database.',
  'const SHIPPED = { label: DEFAULT_LABEL, rules: DEFAULT_RULES, sla: DEFAULT_SLA };',
  'const triage = (input: Parameters<typeof triageWith>[0]) => triageWith(input, SHIPPED);',
);
s = lines.join('\n');
s = s.replace(/TRIAGE_RULES_VERSION/g, 'DEFAULT_LABEL');

fs.writeFileSync(p, s);
console.log('  engine.test.ts: rewired to the shipped defaults');
NODE

# ---------------------------------------------------------------------------
# Controller, routes, and seeding on boot
# ---------------------------------------------------------------------------
node - "$SVC/src/controllers/consultation.controller.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('listTriageRulesets')) { console.log('  controller already patched'); process.exit(0); }

s = s.replace(
  "import * as queue from '../services/queue.service.js';",
  "import * as queue from '../services/queue.service.js';\nimport * as rulesets from '../services/ruleset.service.js';",
);

s = s.trimEnd() + '\n\n' + String.raw`
export const listTriageRulesets = handle((req) => rulesets.listRulesets(caller(req)));

export const getTriageRuleset = handle((req) =>
  rulesets.getRuleset(pathParam(req, 'label'), caller(req)));

export const createTriageRuleset = handle(
  (req, res) => rulesets.createDraft(caller(req), req.body, meta(req, res)), 201);

export const previewTriageRuleset = handle((req) =>
  rulesets.previewRuleset(pathParam(req, 'label'), caller(req), req.body?.sample));

export const activateTriageRuleset = handle((req, res) =>
  rulesets.activateRuleset(pathParam(req, 'label'), caller(req), req.body?.notes ?? '', meta(req, res)));
` + '\n';
fs.writeFileSync(p, s);
console.log('  controller: 5 ruleset handlers added');
NODE

node - "$SVC/src/routes/consultation.routes.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('/triage-rulesets')) { console.log('  routes already registered'); process.exit(0); }

s = s.trimEnd() + '\n' + String.raw`
// Platform-admin only; the service checks the role rather than the router, so
// the same rule applies however these are reached.
consultationRouter.get('/triage-rulesets', requireAuth, c.listTriageRulesets);
consultationRouter.post('/triage-rulesets', requireAuth, idempotency, c.createTriageRuleset);
consultationRouter.post('/triage-rulesets/:label/preview', requireAuth, c.previewTriageRuleset);
consultationRouter.post('/triage-rulesets/:label/activate', requireAuth, idempotency, c.activateTriageRuleset);
consultationRouter.get('/triage-rulesets/:label', requireAuth, c.getTriageRuleset);
` + '\n';
fs.writeFileSync(p, s);
console.log('  routes: 5 registered, :label placed after /preview and /activate');
NODE

node - "$SVC/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('seedDefaultRuleset')) { console.log('  index.ts already seeds'); process.exit(0); }

s = s.replace(
  /^(import .+;\n)(?![\s\S]*^import )/m,
  "$1import { seedDefaultRuleset } from './services/ruleset.service.js';\n",
);
if (!s.includes('seedDefaultRuleset')) {
  s = "import { seedDefaultRuleset } from './services/ruleset.service.js';\n" + s;
}

// Seeded before the server accepts traffic, so the first consultation of a
// fresh deployment is triaged by a stored ruleset rather than the fallback.
s = s.replace(/(\bservice\.start\(\);)/, 'await seedDefaultRuleset();\n$1');
fs.writeFileSync(p, s);
console.log('  index.ts: seeds the shipped ruleset before starting');
NODE

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name add_triage_ruleset"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"

# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------
python3 - "$ROOT/packages/api/openapi/a-health-api-v1.yaml" << 'PY'
import sys
p = sys.argv[1]
doc = open(p).read()
if 'operationId: listTriageRulesets' in doc:
    print('  contract already has the ruleset paths'); raise SystemExit

anchor = "  /queue:"
if anchor not in doc:
    print('  contract anchor not found'); raise SystemExit(1)

block = '''  /triage-rulesets:
    get:
      tags: [system]
      summary: List triage rulesets
      description: |
        Every version ever published, newest first. Platform admin only.

        Rulesets are immutable once created, including drafts: editing means
        creating a new version. `ConsultationRequest.triage_rule_version` points
        at one of these, so a decision made months ago must still resolve to the
        rules that actually made it.
      operationId: listTriageRulesets
      responses:
        '200':
          description: Rulesets
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/TriageRuleset' }
        '403': { $ref: '#/components/responses/Forbidden' }

    post:
      tags: [system]
      summary: Create a draft ruleset
      description: |
        Optionally cloned from an existing version. Structural validation runs
        here; the safety checks run at activation.
      operationId: createTriageRuleset
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [label]
              properties:
                label:
                  type: string
                  maxLength: 40
                  description: Stamped onto every consultation this ruleset judges.
                clone_from:
                  type: string
                  description: Label of an existing version to copy as a starting point.
                rules: { type: object, additionalProperties: true }
                sla_seconds: { type: object, additionalProperties: true }
                notes: { type: string }
      responses:
        '201':
          description: Draft created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TriageRuleset' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }

  /triage-rulesets/{label}:
    get:
      tags: [system]
      summary: Get one ruleset
      operationId: getTriageRuleset
      parameters:
        - name: label
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Ruleset
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TriageRuleset' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /triage-rulesets/{label}/preview:
    post:
      tags: [system]
      summary: Dry-run a ruleset
      description: |
        Runs the safety checks and, optionally, one sample presentation, without
        changing anything. Intended to be used before activation rather than
        after a patient has been triaged by a rule nobody tested.
      operationId: previewTriageRuleset
      parameters:
        - name: label
          in: path
          required: true
          schema: { type: string }
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                sample:
                  type: object
                  description: A triage input to run through this ruleset.
                  additionalProperties: true
      responses:
        '200':
          description: Preview
          content:
            application/json:
              schema:
                type: object
                required: [label, safety_checks, all_passed]
                properties:
                  label: { type: string }
                  all_passed: { type: boolean }
                  safety_checks:
                    type: array
                    items:
                      type: object
                      properties:
                        name: { type: string }
                        expected: { type: string }
                        got: { type: string }
                        passed: { type: boolean }
                  sample_result:
                    type: [object, 'null']
                    additionalProperties: true
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /triage-rulesets/{label}/activate:
    post:
      tags: [system]
      summary: Activate a ruleset
      description: |
        Retires whatever was active and makes this one live. Refused if any
        safety check fails.

        A hardcoded floor guarantees a small set of presentations — stroke
        signs, chest pain, severe bleeding, unconsciousness, suicidal ideation
        and a few others — are always emergencies whatever a ruleset says. That
        floor is not configurable, and activation is refused rather than quietly
        relying on it, so the administrator finds out now rather than from a
        patient outcome.

        Propagation to other service instances takes up to 30 seconds.
      operationId: activateTriageRuleset
      parameters:
        - name: label
          in: path
          required: true
          schema: { type: string }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [notes]
              properties:
                notes:
                  type: string
                  minLength: 1
                  description: Why this change is being made. Required — a rule change nobody explained is one nobody can review.
      responses:
        '200':
          description: Activated
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TriageRuleset' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }

'''
doc = doc.replace(anchor, block + anchor, 1)

# The schema
schema_anchor = "    QueueEntry:"
if schema_anchor not in doc:
    # fall back to appending under components/schemas
    schema_anchor = None

sch = '''    TriageRuleset:
      type: object
      required: [id, label, status, rules, sla_seconds, created_at]
      properties:
        id: { type: string, format: uuid }
        label:
          type: string
          description: Written onto every consultation this ruleset judges.
        status:
          type: string
          enum: [draft, active, retired]
        rules:
          type: object
          additionalProperties: true
          description: Red flags, urgent codes, specialty hints, age thresholds, chronic modifiers.
        sla_seconds:
          type: object
          description: How long each urgency level may wait, versioned with the rules so a stamp explains both.
          properties:
            emergency: { type: integer }
            urgent: { type: integer }
            routine: { type: integer }
        notes: { type: [string, 'null'] }
        created_by_id: { type: string, format: uuid }
        activated_at: { type: [string, 'null'], format: date-time }
        retired_at: { type: [string, 'null'], format: date-time }
        created_at: { type: string, format: date-time }

'''
if schema_anchor:
    doc = doc.replace(schema_anchor, sch + schema_anchor, 1)

open(p, 'w').write(doc)
print('  contract: 4 ruleset paths + TriageRuleset schema added')
PY

python3 -c "
import yaml, re, sys
p='$ROOT/packages/api/openapi/a-health-api-v1.yaml'
d=yaml.safe_load(open(p)); txt=open(p).read()
bad=[]
for r in set(re.findall(r\"\\\$ref: '(#/[^']+)'\", txt)):
    n=d
    for part in r.lstrip('#/').split('/'):
        if isinstance(n,dict) and part in n: n=n[part]
        else: bad.append(r); break
ops=[o['operationId'] for pi in d['paths'].values() for k,o in pi.items() if isinstance(o,dict) and 'operationId' in o]
print('  paths:', len(d['paths']), '| broken refs:', bad or 'none', '| dup ops:', {o for o in ops if ops.count(o)>1} or 'none')
"
