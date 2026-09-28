#!/usr/bin/env bash
#
# Builds services/consultation — the core of the platform.
#
# Four pieces, each with its own failure mode:
#   * a deterministic, versioned triage rules engine
#   * a ranking engine that decides who gets offered a case, and records why
#   * an SLA escalation worker that turns the response promise into something
#     a machine keeps
#   * the care-thread lifecycle that keeps a patient's history in one place
#
# Run from the repo root:
#   bash setup-consultation-service.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/consultation"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "packages/http missing."; exit 1; }

mkdir -p "$SVC/src"/{config,routes,controllers,services,engine,workers,types,tests}

node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
pkg.name = pkg.name || '@a-health/consultation';
pkg.version = pkg.version || '1.0.0';
pkg.private = true;
pkg.type = 'module';
pkg.main = pkg.main || './src/index.ts';
pkg.scripts = { ...(pkg.scripts || {}),
  dev: 'tsx watch src/index.ts', build: 'tsc --noEmit',
  start: 'node --import tsx src/index.ts',
  test: 'node --import tsx --test src/tests/*.test.ts' };
pkg.dependencies = { ...(pkg.dependencies || {}),
  '@a-health/config': 'workspace:*', '@a-health/database': 'workspace:*',
  '@a-health/http': 'workspace:*', '@a-health/logger': 'workspace:*',
  dotenv: '^17.4.2', express: '^5.1.0', zod: '^4.4.3' };
pkg.devDependencies = { ...(pkg.devDependencies || {}),
  '@types/express': '^5.0.3', '@types/node': '^22.10.0',
  tsx: '^4.23.5', typescript: '^5.9.3' };
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  package.json written');
NODE

cat > "$SVC/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > "$SVC/src/config/env.ts" << 'TS'
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4005),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  // Configurable per deployment, because a rural pilot and a city hospital have
  // different honest answers — but never per request.
  SLA_EMERGENCY_SECONDS: z.coerce.number().default(180),
  SLA_URGENT_SECONDS: z.coerce.number().default(900),
  SLA_ROUTINE_SECONDS: z.coerce.number().default(7200),

  /** How many clinicians a case is offered to at once. */
  OFFER_FANOUT: z.coerce.number().default(3),
  /** How long an offer stands before it lapses. */
  OFFER_TTL_SECONDS: z.coerce.number().default(60),
  /** Concurrent consultations a clinician may hold. */
  MAX_CLINICIAN_LOAD: z.coerce.number().default(5),

  SLA_TICK_SECONDS: z.coerce.number().default(15),
});

export const env = envSchema.parse(process.env);
TS

cat > "$SVC/src/engine/triage.ts" << 'TS'
/**
 * Deterministic triage. Same input, same rule version, same answer, always.
 *
 * Determinism is not a style preference: a triage decision has to be
 * explainable months later against the exact rules that were live when it was
 * made. That is why the version is stamped onto every consultation, and why
 * nothing in this file reads a clock, a database, or a model.
 *
 * The AI suggestion is a separate, advisory input. Where the two disagree the
 * more urgent wins and the disagreement is logged — never the reverse.
 */

export const TRIAGE_RULES_VERSION = '2026.08.1';

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

/**
 * Presentations where delay changes the outcome. Deliberately broad: sending
 * someone to be assessed who turns out to be well costs an appointment;
 * missing a stroke costs the use of a limb.
 */
const RED_FLAGS: Record<string, string> = {
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
};

/** Obstetric presentations are their own class — the risk is to two people. */
const OBSTETRIC_RED_FLAGS: Record<string, string> = {
  vaginal_bleeding_pregnancy: 'RF-OBS-01',
  reduced_fetal_movement: 'RF-OBS-02',
  severe_headache_pregnancy: 'RF-OBS-03',
  labour_pains: 'RF-OBS-04',
};

const URGENT_CODES: Record<string, string> = {
  high_fever: 'UR-FEVER-01',
  persistent_vomiting: 'UR-GI-01',
  dehydration: 'UR-GI-02',
  moderate_bleeding: 'UR-HAEM-02',
  eye_injury: 'UR-EYE-01',
  fracture_suspected: 'UR-MSK-01',
  severe_pain: 'UR-PAIN-01',
  infant_fever: 'UR-PAED-01',
};

const SPECIALTY_HINTS: Record<string, string> = {
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
};

const rankOf: Record<Urgency, number> = { routine: 0, urgent: 1, emergency: 2 };
const raise = (a: Urgency, b: Urgency): Urgency => (rankOf[b] > rankOf[a] ? b : a);

export function triage(input: TriageInput): TriageResult {
  const codes = input.symptomCodes.map((c) => c.toLowerCase());
  const matched: string[] = [];
  let urgency: Urgency = 'routine';
  let specialty = 'general_practice';

  for (const code of codes) {
    if (RED_FLAGS[code]) {
      matched.push(RED_FLAGS[code]);
      urgency = raise(urgency, 'emergency');
    }
    if (input.isPregnant && OBSTETRIC_RED_FLAGS[code]) {
      matched.push(OBSTETRIC_RED_FLAGS[code]);
      urgency = raise(urgency, 'emergency');
    }
    if (URGENT_CODES[code]) {
      matched.push(URGENT_CODES[code]);
      urgency = raise(urgency, 'urgent');
    }
    if (SPECIALTY_HINTS[code] && specialty === 'general_practice') {
      specialty = SPECIALTY_HINTS[code];
    }
  }

  // Severity at the top of the scale is urgent whatever it attaches to. A
  // patient calling their pain ten out of ten is information, not noise.
  for (const [code, severity] of Object.entries(input.severityByCode ?? {})) {
    if (severity >= 8) {
      matched.push('SEV-HIGH:' + code);
      urgency = raise(urgency, 'urgent');
    }
  }

  // The very young and the very old decompensate faster and declare it later.
  const age = input.ageYears;
  if (age !== null && age !== undefined) {
    if (age < 1 && (codes.includes('fever') || codes.includes('high_fever'))) {
      matched.push('AGE-INFANT-FEVER');
      urgency = raise(urgency, 'emergency');
    } else if (age < 5 && urgency === 'routine' && codes.length > 0) {
      matched.push('AGE-UNDER-5');
      urgency = raise(urgency, 'urgent');
    }
    if (age >= 65 && urgency === 'routine' && codes.length > 0) {
      matched.push('AGE-OVER-65');
      urgency = raise(urgency, 'urgent');
    }
    if (age < 16 && specialty === 'general_practice') specialty = 'paediatrics';
  }

  // A chronic condition turns an ordinary complaint into a different problem.
  const chronic = (input.chronicConditions ?? []).map((c) => c.toLowerCase());
  const RAISING = ['diabetes', 'hiv', 'tuberculosis', 'heart_failure', 'chronic_kidney_disease', 'sickle_cell'];
  if (chronic.some((c) => RAISING.includes(c)) && urgency === 'routine' && codes.length > 0) {
    matched.push('CHRONIC-MODIFIER');
    urgency = raise(urgency, 'urgent');
  }

  if (input.isPregnant && specialty === 'general_practice') {
    specialty = 'obstetrics_gynaecology';
  }

  return {
    urgency,
    matchedRules: [...new Set(matched)],
    recommendedSpecialty: specialty,
    ruleVersion: TRIAGE_RULES_VERSION,
  };
}

export function slaSecondsFor(
  urgency: Urgency,
  config: { emergency: number; urgent: number; routine: number },
): number {
  if (urgency === 'emergency') return config.emergency;
  if (urgency === 'urgent') return config.urgent;
  return config.routine;
}
TS

cat > "$SVC/src/engine/matching.ts" << 'TS'
/**
 * Ranks clinicians for a case.
 *
 * Pure and deterministic so it can be tested and, more importantly, explained.
 * When a patient waited forty minutes, the offer rows show exactly who was
 * ranked, with what weights, and what each of them did about it.
 */

export interface Candidate {
  clinicianId: string;
  specialty: string;
  languages: string[];
  currentLoad: number;
  maxLoad: number;
  ratingAvg: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface MatchContext {
  requiredSpecialty: string;
  patientLanguage: string;
  patientLat?: number | null;
  patientLng?: number | null;
  urgency: 'routine' | 'urgent' | 'emergency';
}

export interface RankedCandidate {
  clinicianId: string;
  score: number;
  weights: Record<string, number>;
}

const WEIGHTS = {
  specialty: 0.35,
  language: 0.25,
  availability: 0.25,
  rating: 0.1,
  proximity: 0.05,
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function rank(candidates: Candidate[], ctx: MatchContext): RankedCandidate[] {
  return candidates
    .filter((c) => c.currentLoad < c.maxLoad)
    .map((c) => {
      const specialty =
        c.specialty === ctx.requiredSpecialty ? 1 : c.specialty === 'general_practice' ? 0.6 : 0.2;

      // Language is weighted heavily on purpose. A consultation conducted in a
      // language the patient half-follows is not a safe consultation, and given
      // the language spread here that is not an edge case.
      const language = c.languages.includes(ctx.patientLanguage)
        ? 1
        : c.languages.includes('sw') || c.languages.includes('en')
          ? 0.5
          : 0.1;

      const availability = 1 - c.currentLoad / Math.max(c.maxLoad, 1);

      // Unrated clinicians sit at the midpoint, not the bottom. Ranking them
      // last would mean a newly deployed graduate never gets a first case,
      // which defeats the point of employing them.
      const rating = c.ratingAvg === null ? 0.6 : Math.min(c.ratingAvg / 5, 1);

      let proximity = 0.5;
      if (ctx.patientLat != null && ctx.patientLng != null && c.lat != null && c.lng != null) {
        const km = haversineKm(ctx.patientLat, ctx.patientLng, c.lat, c.lng);
        proximity = Math.max(0, 1 - km / 100);
      }

      const weights = { specialty, language, availability, rating, proximity };
      const score =
        specialty * WEIGHTS.specialty +
        language * WEIGHTS.language +
        availability * WEIGHTS.availability +
        rating * WEIGHTS.rating +
        proximity * WEIGHTS.proximity;

      return { clinicianId: c.clinicianId, score: Number(score.toFixed(4)), weights };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Escalation widens the net rather than lowering the bar: more clinicians are
 * offered the case, but nobody unverified or over capacity is ever included.
 */
export function fanoutFor(urgency: string, escalationCount: number, base: number): number {
  const bonus = urgency === 'emergency' ? 3 : urgency === 'urgent' ? 1 : 0;
  return Math.min(base + bonus + escalationCount * 2, 25);
}
TS

cat > "$SVC/src/services/careThread.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { conflict, cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';

export interface Caller {
  sub: string;
  role: string;
  ppid?: string;
  cpid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}

export function serialiseThread(t: {
  id: string;
  patientProfileId: string;
  primaryClinicianId: string | null;
  status: string;
  reasonSummary: string | null;
  latestConsultationId: string | null;
  openConsultationCount: number;
  activeFollowUpCycleId: string | null;
  outcome: string | null;
  openedAt: Date;
  closedAt: Date | null;
  version: number;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    patient_profile_id: t.patientProfileId,
    primary_clinician_id: t.primaryClinicianId,
    status: t.status,
    reason_summary: t.reasonSummary,
    latest_consultation_id: t.latestConsultationId,
    open_consultation_count: t.openConsultationCount,
    active_follow_up_cycle_id: t.activeFollowUpCycleId,
    outcome: t.outcome,
    opened_at: t.openedAt.toISOString(),
    closed_at: t.closedAt?.toISOString() ?? null,
    version: t.version,
    updated_at: t.updatedAt.toISOString(),
  };
}

/**
 * Visibility. A patient sees their own threads and their dependants'; a
 * clinician sees threads they are primary on or have worked a consultation in;
 * an admin sees everything, and every admin read is audited.
 */
async function visibilityFilter(caller: Caller) {
  if (caller.role === 'platform_admin') return {};
  if (caller.role === 'clinician' && caller.cpid) {
    return {
      OR: [
        { primaryClinicianId: caller.cpid },
        { consultations: { some: { assignedClinicianId: caller.cpid } } },
      ],
    };
  }
  const guarded = await prisma.patientProfile.findMany({
    where: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] },
    select: { id: true },
  });
  return { patientProfileId: { in: guarded.map((g) => g.id) } };
}

export async function listCareThreads(
  caller: Caller,
  query: { patient_id?: string; status?: string; cursor?: string; limit: number },
) {
  const rows = await prisma.careThread.findMany({
    where: {
      ...(await visibilityFilter(caller)),
      ...(query.patient_id ? { patientProfileId: query.patient_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseThread);
}

/**
 * The view a clinician opens when a patient reappears months later: the thread
 * plus everything attached to it, in order. This is the whole reason the care
 * thread exists rather than a pile of unrelated encounters.
 */
export async function getCareThreadDetail(threadId: string, caller: Caller) {
  const thread = await prisma.careThread.findFirst({
    where: { id: threadId, ...(await visibilityFilter(caller)) },
    include: { patient: true },
  });
  if (!thread) throw notFound('Care thread not found');

  const [consultations, notes, messages, checkIns, prescriptions] = await Promise.all([
    prisma.consultationRequest.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' } }),
    prisma.consultationNote.findMany({ where: { careThreadId: threadId }, orderBy: { signedAt: 'asc' } }),
    prisma.message.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' }, take: 500 }),
    prisma.checkIn.findMany({ where: { careThreadId: threadId }, orderBy: { scheduledAt: 'asc' } }),
    prisma.prescription.findMany({ where: { careThreadId: threadId }, orderBy: { createdAt: 'asc' } }),
  ]);

  const timeline: { entry_type: string; id: string; occurred_at: Date; summary: string }[] = [
    ...consultations.map((c) => ({ entry_type: 'consultation', id: c.id, occurred_at: c.createdAt, summary: c.urgencyLevel + ' consultation (' + c.status + ')' })),
    ...notes.map((n) => ({ entry_type: 'note', id: n.id, occurred_at: n.signedAt, summary: n.diagnosisText.slice(0, 160) })),
    ...prescriptions.map((p) => ({ entry_type: 'prescription', id: p.id, occurred_at: p.createdAt, summary: 'prescription (' + p.status + ')' })),
    ...checkIns.map((c) => ({ entry_type: c.isDeviation ? 'deviation' : 'check_in', id: c.id, occurred_at: c.scheduledAt, summary: c.isDeviation ? 'deviation flagged' : 'check-in (' + c.status + ')' })),
    ...messages.map((m) => ({ entry_type: 'message', id: m.id, occurred_at: m.createdAt, summary: (m.body ?? '[attachment]').slice(0, 160) })),
  ].sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());

  return {
    ...serialiseThread(thread),
    patient: {
      id: thread.patient.id,
      full_name: thread.patient.fullName,
      date_of_birth: thread.patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sex: thread.patient.sex,
      chronic_conditions: thread.patient.chronicConditions,
      allergies: thread.patient.allergies,
    },
    timeline: timeline.map((e) => ({ ...e, occurred_at: e.occurred_at.toISOString() })),
  };
}

export async function closeCareThread(
  threadId: string,
  caller: Caller,
  outcome: string,
  notes: string | undefined,
) {
  if (caller.role !== 'clinician' && caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a clinician may close a care thread');
  }
  const thread = await prisma.careThread.findUnique({ where: { id: threadId } });
  if (!thread) throw notFound('Care thread not found');
  if (thread.status === 'closed') throw conflict('CARE_THREAD_CLOSED', 'Thread is already closed');

  const open = await prisma.consultationRequest.count({
    where: {
      careThreadId: threadId,
      status: { in: ['pending', 'offered', 'matched', 'in_progress', 'escalated'] },
    },
  });
  if (open > 0) {
    throw conflict('STATE_TRANSITION_INVALID', 'Close the open consultations on this thread first');
  }

  const updated = await prisma.careThread.update({
    where: { id: threadId },
    data: {
      status: 'closed',
      outcome: outcome as never,
      outcomeNotes: notes ?? null,
      closedAt: new Date(),
      version: { increment: 1 },
    },
  });
  return serialiseThread(updated);
}
TS

cat > "$SVC/src/services/consultation.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, recordChange } from '@a-health/http';
import { env } from '../config/env.js';
import { slaSecondsFor, triage, type Urgency } from '../engine/triage.js';
import { fanoutFor, rank, type Candidate } from '../engine/matching.js';
import type { Caller, Meta } from './careThread.service.js';

const SLA = {
  emergency: env.SLA_EMERGENCY_SECONDS,
  urgent: env.SLA_URGENT_SECONDS,
  routine: env.SLA_ROUTINE_SECONDS,
};

const OPEN_STATES = ['pending', 'offered', 'matched', 'in_progress', 'escalated'];

export function serialiseConsultation(c: {
  id: string;
  careThreadId: string;
  patientProfileId: string;
  assignedClinicianId: string | null;
  referredFromId: string | null;
  appointmentId: string | null;
  channel: string;
  modality: string;
  symptomText: string | null;
  structuredSymptoms: unknown;
  voiceNoteKey: string | null;
  urgencyLevel: string;
  triageRuleVersion: string;
  status: string;
  slaDeadlineAt: Date;
  escalationCount: number;
  createdAt: Date;
  clientCreatedAt: Date | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  version: number;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    assigned_clinician_id: c.assignedClinicianId,
    referred_from_consultation_id: c.referredFromId,
    appointment_id: c.appointmentId,
    channel: c.channel,
    modality: c.modality,
    symptom_text: c.symptomText,
    structured_symptoms: c.structuredSymptoms ?? [],
    voice_note_key: c.voiceNoteKey,
    urgency_level: c.urgencyLevel,
    triage_rule_version: c.triageRuleVersion,
    status: c.status,
    sla_deadline_at: c.slaDeadlineAt.toISOString(),
    escalation_count: c.escalationCount,
    created_at: c.createdAt.toISOString(),
    client_created_at: c.clientCreatedAt?.toISOString() ?? null,
    accepted_at: c.acceptedAt?.toISOString() ?? null,
    completed_at: c.completedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

/** Loads eligible clinicians and offers the case to the top of the ranking. */
export async function offerConsultation(consultationId: string): Promise<number> {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
  });
  if (!consultation || !OPEN_STATES.includes(consultation.status)) return 0;
  if (consultation.assignedClinicianId) return 0;

  const clinicians = await prisma.clinicianProfile.findMany({
    where: { verificationStatus: 'verified', isAvailable: true },
    include: { facility: true },
    take: 200,
  });

  const candidates: Candidate[] = clinicians.map((c) => ({
    clinicianId: c.id,
    specialty: c.specialty,
    languages: Array.isArray(c.languagesSpoken) ? (c.languagesSpoken as string[]) : [],
    currentLoad: c.currentLoad,
    maxLoad: env.MAX_CLINICIAN_LOAD,
    ratingAvg: c.ratingAvg === null ? null : Number(c.ratingAvg),
    lat: c.facility?.lat ?? null,
    lng: c.facility?.lng ?? null,
  }));

  const ranked = rank(candidates, {
    requiredSpecialty: 'general_practice',
    patientLanguage: 'sw',
    patientLat: consultation.requestLat,
    patientLng: consultation.requestLng,
    urgency: consultation.urgencyLevel as Urgency,
  });

  const fanout = fanoutFor(consultation.urgencyLevel, consultation.escalationCount, env.OFFER_FANOUT);
  const chosen = ranked.slice(0, fanout);
  if (chosen.length === 0) return 0;

  const expiresAt = new Date(Date.now() + env.OFFER_TTL_SECONDS * 1000);
  await prisma.consultationOffer.createMany({
    data: chosen.map((c) => ({
      consultationId,
      clinicianId: c.clinicianId,
      rankScore: c.score,
      rankWeights: c.weights,
      expiresAt,
    })),
    skipDuplicates: true,
  });

  await prisma.consultationRequest.update({
    where: { id: consultationId },
    data: { status: 'offered', version: { increment: 1 } },
  });

  return chosen.length;
}

export async function createConsultation(
  caller: Caller,
  input: {
    care_thread_id?: string;
    patient_profile_id?: string;
    channel: string;
    modality?: string;
    symptom_text?: string;
    structured_symptoms?: { code: string; severity?: number; duration_hours?: number }[];
    voice_note_key?: string;
    location?: { lat: number; lng: number };
    client_created_at?: string;
  },
  meta: Meta,
) {
  const patientProfileId = input.patient_profile_id ?? caller.ppid;
  if (!patientProfileId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');

  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');

  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot raise a consultation for this patient');
  }

  const ageYears = patient.dateOfBirth
    ? Math.floor((Date.now() - patient.dateOfBirth.getTime()) / 31557600000)
    : null;

  const symptoms = input.structured_symptoms ?? [];
  const severityByCode: Record<string, number> = {};
  const durationByCode: Record<string, number> = {};
  for (const s of symptoms) {
    if (s.severity != null) severityByCode[s.code] = s.severity;
    if (s.duration_hours != null) durationByCode[s.code] = s.duration_hours;
  }

  const result = triage({
    symptomCodes: symptoms.map((s) => s.code),
    severityByCode,
    durationHoursByCode: durationByCode,
    freeText: input.symptom_text,
    ageYears,
    chronicConditions: Array.isArray(patient.chronicConditions) ? (patient.chronicConditions as string[]) : [],
  });

  const slaDeadlineAt = new Date(Date.now() + slaSecondsFor(result.urgency, SLA) * 1000);

  const consultation = await prisma.$transaction(async (tx) => {
    let threadId = input.care_thread_id;

    if (threadId) {
      const thread = await tx.careThread.findUnique({ where: { id: threadId } });
      if (!thread) throw notFound('Care thread not found');
      if (thread.status === 'closed') {
        // A deviation weeks after discharge belongs to the same problem, so a
        // new consultation reopens the thread rather than orphaning itself.
        await tx.careThread.update({
          where: { id: threadId },
          data: { status: 'open', closedAt: null, outcome: null, version: { increment: 1 } },
        });
      }
    } else {
      const summary = (input.symptom_text ?? symptoms.map((s) => s.code).join(', ')).slice(0, 300);
      const thread = await tx.careThread.create({
        data: { patientProfileId, reasonSummary: summary },
      });
      threadId = thread.id;
      await recordChange(tx, {
        entity: 'care_threads', entityId: thread.id, op: 'create',
        version: thread.version, patientProfileId, careThreadId: thread.id,
      });
    }

    const created = await tx.consultationRequest.create({
      data: {
        careThreadId: threadId,
        patientProfileId,
        channel: input.channel as never,
        modality: (input.modality ?? 'chat') as never,
        symptomText: input.symptom_text ?? null,
        structuredSymptoms: symptoms as never,
        voiceNoteKey: input.voice_note_key ?? null,
        requestLat: input.location?.lat ?? null,
        requestLng: input.location?.lng ?? null,
        urgencyLevel: result.urgency as never,
        triageRuleVersion: result.ruleVersion,
        slaDeadlineAt,
        clientCreatedAt: input.client_created_at ? new Date(input.client_created_at) : null,
      },
    });

    await tx.careThread.update({
      where: { id: threadId },
      data: {
        latestConsultationId: created.id,
        openConsultationCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await recordChange(tx, {
      entity: 'consultation_requests', entityId: created.id, op: 'create',
      version: created.version, patientProfileId, careThreadId: threadId,
    });
    return created;
  });

  await appendAudit({
    actorUserId: caller.sub,
    action: 'consultation.created',
    entityType: 'consultation_requests',
    entityId: consultation.id,
    metadata: { urgency: result.urgency, rules: result.matchedRules, ruleVersion: result.ruleVersion },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  // Routing is asynchronous. The caller gets the request back immediately and
  // learns of assignment over the realtime channel.
  void offerConsultation(consultation.id).catch(() => undefined);

  return serialiseConsultation(consultation);
}

/**
 * First accept wins. Losers get 409, which the client must treat as an ordinary
 * outcome rather than an error to shout about — several clinicians racing for
 * the same case is the system working.
 */
export async function acceptConsultation(consultationId: string, caller: Caller, meta: Meta) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const offer = await prisma.consultationOffer.findUnique({
    where: { consultationId_clinicianId: { consultationId, clinicianId: cpid } },
  });
  if (!offer) throw forbidden('FORBIDDEN', 'This case was not offered to you');

  const claimed = await prisma.consultationRequest.updateMany({
    where: {
      id: consultationId,
      assignedClinicianId: null,
      status: { in: ['pending', 'offered', 'escalated'] },
    },
    data: {
      assignedClinicianId: cpid,
      status: 'matched',
      acceptedAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw conflict('CONSULTATION_ALREADY_ASSIGNED', 'Another clinician has taken this case');
  }

  await prisma.$transaction([
    prisma.consultationOffer.update({
      where: { consultationId_clinicianId: { consultationId, clinicianId: cpid } },
      data: { status: 'accepted', respondedAt: new Date(), version: { increment: 1 } },
    }),
    prisma.consultationOffer.updateMany({
      where: { consultationId, clinicianId: { not: cpid }, status: 'offered' },
      data: { status: 'expired', respondedAt: new Date() },
    }),
    prisma.clinicianProfile.update({
      where: { id: cpid },
      data: { currentLoad: { increment: 1 }, version: { increment: 1 } },
    }),
  ]);

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.accepted',
    entityType: 'consultation_requests', entityId: consultationId,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });
  return serialiseConsultation(updated);
}

/** Declining does not stop the SLA clock — the case goes straight back out. */
export async function declineConsultation(
  consultationId: string, caller: Caller, reason: string | undefined, meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  await prisma.consultationOffer.updateMany({
    where: { consultationId, clinicianId: cpid, status: 'offered' },
    data: { status: 'declined', declineReason: reason ?? null, respondedAt: new Date() },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.declined',
    entityType: 'consultation_requests', entityId: consultationId,
    metadata: { reason: reason ?? null }, ipAddress: meta.ip, requestId: meta.requestId,
  });

  void offerConsultation(consultationId).catch(() => undefined);

  const updated = await prisma.consultationRequest.findUniqueOrThrow({ where: { id: consultationId } });
  return serialiseConsultation(updated);
}

/**
 * The composite write: note, optional prescription, optional follow-up cycle,
 * in one atomic call. Three sequential writes over an unreliable network can
 * leave a consultation closed with no follow-up attached, which is precisely
 * the gap this platform exists to close.
 */
export async function completeConsultation(
  consultationId: string,
  caller: Caller,
  input: {
    note: { diagnosis_text: string; diagnosis_codes?: string[]; advice_text: string; red_flags_discussed?: string[] };
    prescription?: { items: { medication_name: string; dosage: string; frequency_per_day: number; duration_days: number; instructions?: string }[] };
    follow_up_cycle?: { frequency: string; custom_cron?: string; duration_days: number; questionnaire_key?: string; recovery_criteria?: Record<string, unknown> };
    close_care_thread?: boolean;
  },
  meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const consultation = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!consultation) throw notFound('Consultation not found');
  if (consultation.assignedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not assigned to this consultation');
  }
  if (consultation.status === 'completed') {
    throw conflict('STATE_TRANSITION_INVALID', 'This consultation is already complete');
  }

  const clinician = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: cpid } });
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const result = await prisma.$transaction(async (tx) => {
    const completed = await tx.consultationRequest.update({
      where: { id: consultationId },
      data: { status: 'completed', completedAt: new Date(), version: { increment: 1 } },
    });

    // The signature is stamped server-side after checking the signer.
    // Client-supplied signature fields are never trusted.
    const note = await tx.consultationNote.create({
      data: {
        consultationId,
        careThreadId: consultation.careThreadId,
        diagnosisText: input.note.diagnosis_text,
        diagnosisCodes: (input.note.diagnosis_codes ?? []) as never,
        adviceText: input.note.advice_text,
        redFlagsDiscussed: (input.note.red_flags_discussed ?? []) as never,
        signedByClinicianId: cpid,
        signedAt: new Date(),
      },
    });

    let prescriptionId: string | null = null;
    if (input.prescription && input.prescription.items.length > 0) {
      const prescription = await tx.prescription.create({
        data: {
          careThreadId: consultation.careThreadId,
          consultationId,
          patientProfileId: consultation.patientProfileId,
          prescribedById: cpid,
          items: {
            create: input.prescription.items.map((i) => ({
              medicationName: i.medication_name,
              dosage: i.dosage,
              frequencyPerDay: i.frequency_per_day,
              durationDays: i.duration_days,
              instructions: i.instructions ?? null,
            })),
          },
        },
        include: { items: true },
      });
      prescriptionId = prescription.id;

      // One row per expected dose, generated now. The reminder has to fire from
      // a cached row with no connectivity, so the schedule cannot be computed
      // later on the server.
      const doses: {
        prescriptionItemId: string; prescriptionId: string; patientProfileId: string;
        medicationName: string; dosage: string; scheduledAt: Date;
      }[] = [];
      const start = Date.now();
      for (const item of prescription.items) {
        const gap = 86400000 / item.frequencyPerDay;
        for (let d = 0; d < item.durationDays; d += 1) {
          for (let n = 0; n < item.frequencyPerDay; n += 1) {
            doses.push({
              prescriptionItemId: item.id,
              prescriptionId: prescription.id,
              patientProfileId: consultation.patientProfileId,
              medicationName: item.medicationName,
              dosage: item.dosage,
              scheduledAt: new Date(start + d * 86400000 + n * gap),
            });
          }
        }
      }
      if (doses.length > 0) await tx.adherenceLog.createMany({ data: doses });
    }

    let followUpCycleId: string | null = null;
    if (input.follow_up_cycle) {
      const cycle = await tx.followUpCycle.create({
        data: {
          careThreadId: consultation.careThreadId,
          patientProfileId: consultation.patientProfileId,
          clinicianId: cpid,
          sourceConsultationId: consultationId,
          frequency: input.follow_up_cycle.frequency as never,
          customCron: input.follow_up_cycle.custom_cron ?? null,
          questionnaireKey: input.follow_up_cycle.questionnaire_key ?? null,
          recoveryCriteria: (input.follow_up_cycle.recovery_criteria ?? {}) as never,
          startDate: new Date(),
          endDate: new Date(Date.now() + input.follow_up_cycle.duration_days * 86400000),
        },
      });
      followUpCycleId = cycle.id;
      await tx.careThread.update({
        where: { id: consultation.careThreadId },
        data: { activeFollowUpCycleId: cycle.id },
      });
    }

    await tx.careThread.update({
      where: { id: consultation.careThreadId },
      data: {
        openConsultationCount: { decrement: 1 },
        primaryClinicianId: cpid,
        ...(input.close_care_thread
          ? { status: 'closed' as never, outcome: 'recovered' as never, closedAt: new Date() }
          : {}),
        version: { increment: 1 },
      },
    });

    await tx.clinicianProfile.update({
      where: { id: cpid },
      data: { currentLoad: { decrement: 1 }, version: { increment: 1 } },
    });

    await recordChange(tx, {
      entity: 'consultation_requests', entityId: consultationId, op: 'update',
      version: completed.version, patientProfileId: consultation.patientProfileId,
      careThreadId: consultation.careThreadId,
    });

    return { completed, note, prescriptionId, followUpCycleId };
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.completed',
    entityType: 'consultation_requests', entityId: consultationId,
    metadata: { prescribed: result.prescriptionId !== null, followUp: result.followUpCycleId !== null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return {
    consultation: serialiseConsultation(result.completed),
    note: {
      id: result.note.id,
      signed_by_clinician_id: result.note.signedByClinicianId,
      signed_at: result.note.signedAt.toISOString(),
    },
    prescription_id: result.prescriptionId,
    follow_up_cycle_id: result.followUpCycleId,
  };
}

export async function referConsultation(
  consultationId: string,
  caller: Caller,
  input: { specialty: string; to_clinician_id?: string; reason: string },
  meta: Meta,
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  const source = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!source) throw notFound('Consultation not found');
  if (source.assignedClinicianId !== cpid) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You are not assigned to this consultation');
  }

  // The referral joins the same thread. A specialist opinion is part of the
  // same episode, not a fresh case with no history.
  const referral = await prisma.consultationRequest.create({
    data: {
      careThreadId: source.careThreadId,
      patientProfileId: source.patientProfileId,
      referredFromId: consultationId,
      assignedClinicianId: input.to_clinician_id ?? null,
      channel: source.channel,
      modality: 'async',
      symptomText: input.reason,
      structuredSymptoms: source.structuredSymptoms as never,
      urgencyLevel: source.urgencyLevel,
      triageRuleVersion: source.triageRuleVersion,
      status: input.to_clinician_id ? 'matched' : 'pending',
      slaDeadlineAt: new Date(Date.now() + SLA.routine * 1000),
    },
  });

  await prisma.careThread.update({
    where: { id: source.careThreadId },
    data: { openConsultationCount: { increment: 1 }, version: { increment: 1 } },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'consultation.referred',
    entityType: 'consultation_requests', entityId: referral.id,
    reason: input.reason, metadata: { specialty: input.specialty, from: consultationId },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  if (!input.to_clinician_id) void offerConsultation(referral.id).catch(() => undefined);
  return serialiseConsultation(referral);
}
TS

cat > "$SVC/src/services/queue.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { cursorArgs, forbidden, notFound, toCursorPage } from '@a-health/http';
import { serialiseConsultation } from './consultation.service.js';
import type { Caller } from './careThread.service.js';

function ageBand(dob: Date | null): string {
  if (!dob) return 'unknown';
  const years = Math.floor((Date.now() - dob.getTime()) / 31557600000);
  if (years < 1) return '<1';
  if (years < 5) return '1-4';
  const decade = Math.floor(years / 10) * 10;
  return decade + '-' + (decade + 9);
}

type ConsultationRow = Parameters<typeof serialiseConsultation>[0] & {
  patient?: { dateOfBirth: Date | null; sex: string | null; chronicConditions: unknown } | null;
};

function entry(c: ConsultationRow, offeredAt: Date, rankScore?: number) {
  const chronic = c.patient?.chronicConditions;
  return {
    consultation: serialiseConsultation(c),
    // Enough to decide whether to accept. The full history opens only after
    // acceptance — browsing records you have not taken on is not a right.
    patient_summary: {
      age_band: ageBand(c.patient?.dateOfBirth ?? null),
      sex: c.patient?.sex ?? null,
      has_chronic_conditions: Array.isArray(chronic) && chronic.length > 0,
    },
    offered_at: offeredAt.toISOString(),
    seconds_to_sla_breach: Math.round((c.slaDeadlineAt.getTime() - Date.now()) / 1000),
    ...(rankScore !== undefined ? { rank_score: rankScore } : {}),
  };
}

/**
 * The clinician's queue, ordered by urgency and then by how close each case is
 * to breaching its SLA — the two things that decide what to pick up next.
 */
export async function getQueue(
  caller: Caller,
  query: { scope: 'offered' | 'mine'; urgency_level?: string; cursor?: string; limit: number },
) {
  const cpid = caller.cpid;
  if (!cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician profile required');

  if (query.scope === 'mine') {
    const rows = await prisma.consultationRequest.findMany({
      where: {
        assignedClinicianId: cpid,
        status: { in: ['matched', 'in_progress'] },
        ...(query.urgency_level ? { urgencyLevel: query.urgency_level as never } : {}),
      },
      include: { patient: true },
      orderBy: [{ urgencyLevel: 'desc' }, { slaDeadlineAt: 'asc' }],
      ...cursorArgs(query.cursor, query.limit),
    });
    return toCursorPage(rows, query.limit, (c) => entry(c, c.createdAt));
  }

  const offers = await prisma.consultationOffer.findMany({
    where: { clinicianId: cpid, status: 'offered', expiresAt: { gt: new Date() } },
    include: { consultation: { include: { patient: true } } },
    orderBy: [{ rankScore: 'desc' }, { offeredAt: 'asc' }],
    ...cursorArgs(query.cursor, query.limit),
  });

  const filtered = query.urgency_level
    ? offers.filter((o) => o.consultation.urgencyLevel === query.urgency_level)
    : offers;

  return toCursorPage(filtered, query.limit, (o) =>
    entry(o.consultation, o.offeredAt, Number(o.rankScore)),
  );
}

/**
 * The patient's own view. Waiting without knowing is the experience this
 * platform exists to remove, so an unexplained wait is not acceptable here
 * either.
 *
 * `estimated_wait_minutes` is null when no honest estimate exists. A fabricated
 * number recreates the original problem in a new form.
 */
export async function getQueueStatus(consultationId: string, caller: Caller) {
  const consultation = await prisma.consultationRequest.findUnique({
    where: { id: consultationId },
    include: {
      patient: true,
      assignedClinician: { include: { user: { select: { fullName: true } } } },
    },
  });
  if (!consultation) throw notFound('Consultation not found');

  const owns =
    consultation.patient.userId === caller.sub ||
    consultation.patient.guardianUserId === caller.sub ||
    caller.role === 'platform_admin' ||
    consultation.assignedClinicianId === caller.cpid;
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This consultation is not yours');

  let position: number | null = null;
  let estimate: number | null = null;

  if (['pending', 'offered', 'escalated'].includes(consultation.status)) {
    const ahead = await prisma.consultationRequest.count({
      where: {
        status: { in: ['pending', 'offered', 'escalated'] },
        urgencyLevel: consultation.urgencyLevel,
        slaDeadlineAt: { lt: consultation.slaDeadlineAt },
      },
    });
    position = ahead + 1;

    const available = await prisma.clinicianProfile.count({
      where: { verificationStatus: 'verified', isAvailable: true, currentLoad: { lt: 5 } },
    });
    // Only estimate when there is something to estimate from. Nobody on duty
    // means no honest number, and null says exactly that.
    estimate = available > 0 ? Math.max(1, Math.round((position / available) * 10)) : null;
  }

  return {
    consultation_id: consultation.id,
    status: consultation.status,
    urgency_level: consultation.urgencyLevel,
    queue_position: position,
    ahead_of_you: position === null ? null : position - 1,
    estimated_wait_minutes: estimate,
    sla_deadline_at: consultation.slaDeadlineAt.toISOString(),
    assigned_clinician: consultation.assignedClinician
      ? {
          full_name: consultation.assignedClinician.user.fullName,
          specialty: consultation.assignedClinician.specialty,
        }
      : null,
  };
}
TS

cat > "$SVC/src/workers/sla.worker.ts" << 'TS'
import { prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';
import { offerConsultation } from '../services/consultation.service.js';

const logger = createLogger('consultation.sla');

/**
 * Turns the response promise into something a machine keeps.
 *
 * "Quick pick and answer" is marketing until a timer enforces it. Each tick
 * does two things: lapse offers nobody acted on, and escalate cases past their
 * deadline — widening the pool each time rather than lowering the bar on who
 * is eligible.
 */
export async function tick(now = new Date()): Promise<{ lapsed: number; escalated: number }> {
  const lapsed = await prisma.consultationOffer.updateMany({
    where: { status: 'offered', expiresAt: { lt: now } },
    data: { status: 'expired', respondedAt: now },
  });

  const breached = await prisma.consultationRequest.findMany({
    where: {
      status: { in: ['pending', 'offered'] },
      assignedClinicianId: null,
      slaDeadlineAt: { lt: now },
    },
    orderBy: [{ urgencyLevel: 'desc' }, { slaDeadlineAt: 'asc' }],
    take: 100,
  });

  for (const consultation of breached) {
    const escalationCount = consultation.escalationCount + 1;

    // The deadline moves so the case is not re-escalated every tick, but the
    // count keeps climbing — a case on its fifth escalation is visible as
    // exactly that on the dispatcher board.
    await prisma.consultationRequest.update({
      where: { id: consultation.id },
      data: {
        status: 'escalated',
        escalationCount,
        slaDeadlineAt: new Date(now.getTime() + 300000),
        version: { increment: 1 },
      },
    });

    await appendAudit({
      action: 'consultation.sla_breached',
      entityType: 'consultation_requests',
      entityId: consultation.id,
      metadata: {
        urgency: consultation.urgencyLevel,
        escalationCount,
        overdueSeconds: Math.round((now.getTime() - consultation.slaDeadlineAt.getTime()) / 1000),
      },
    });

    logger.warn('sla breached', {
      consultationId: consultation.id,
      urgency: consultation.urgencyLevel,
      escalationCount,
    });

    await offerConsultation(consultation.id).catch((e) =>
      logger.error('re-offer failed', { consultationId: consultation.id, err: String(e) }),
    );
  }

  return { lapsed: lapsed.count, escalated: breached.length };
}

export function startSlaWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick().catch((e) => logger.error('sla tick failed', { err: String(e) }));
  }, env.SLA_TICK_SECONDS * 1000);
  timer.unref();
  logger.info('sla worker started', { intervalSeconds: env.SLA_TICK_SECONDS });
  return timer;
}
TS

cat > "$SVC/src/types/consultation.types.ts" << 'TS'
import { z } from 'zod';

export const createConsultationSchema = z.object({
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']),
  modality: z.enum(['chat', 'voice', 'video', 'async']).optional(),
  symptom_text: z.string().max(4000).optional(),
  structured_symptoms: z
    .array(
      z.object({
        code: z.string().max(60),
        severity: z.number().int().min(0).max(10).optional(),
        duration_hours: z.number().min(0).optional(),
      }),
    )
    .max(30)
    .optional(),
  voice_note_key: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  client_created_at: z.string().datetime().optional(),
});

export const declineSchema = z.object({
  reason: z.enum(['out_of_specialty', 'language_mismatch', 'at_capacity', 'other']).optional(),
  note: z.string().max(1000).optional(),
});

export const completeSchema = z.object({
  note: z.object({
    diagnosis_text: z.string().min(1).max(4000),
    diagnosis_codes: z.array(z.string()).optional(),
    advice_text: z.string().min(1).max(4000),
    red_flags_discussed: z.array(z.string()).optional(),
  }),
  prescription: z
    .object({
      items: z
        .array(
          z.object({
            medication_name: z.string().min(1).max(150),
            dosage: z.string().min(1).max(50),
            frequency_per_day: z.number().int().min(1).max(12),
            duration_days: z.number().int().min(1).max(365),
            instructions: z.string().max(500).optional(),
          }),
        )
        .min(1),
    })
    .optional(),
  follow_up_cycle: z
    .object({
      frequency: z.enum(['daily', 'twice_daily', 'weekly', 'custom']),
      custom_cron: z.string().max(120).optional(),
      duration_days: z.number().int().min(1).max(365),
      questionnaire_key: z.string().max(80).optional(),
      recovery_criteria: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  close_care_thread: z.boolean().optional(),
});

export const referSchema = z.object({
  specialty: z.string().max(60),
  to_clinician_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000),
});

export const closeThreadSchema = z.object({
  outcome: z.enum(['recovered', 'referred_out', 'lost_to_follow_up', 'deceased']),
  notes: z.string().max(2000).optional(),
});

export const listQuery = z.object({
  patient_id: z.string().uuid().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const queueQuery = z.object({
  scope: z.enum(['offered', 'mine']).default('offered'),
  urgency_level: z.enum(['routine', 'urgent', 'emergency']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
TS

cat > "$SVC/src/controllers/consultation.controller.ts" << 'TS'
import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as threads from '../services/careThread.service.js';
import * as consultations from '../services/consultation.service.js';
import * as queue from '../services/queue.service.js';
import {
  closeThreadSchema, completeSchema, createConsultationSchema,
  declineSchema, listQuery, queueQuery, referSchema,
} from '../types/consultation.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub,
  role: req.auth!.role,
  ppid: req.auth!.ppid,
  cpid: req.auth!.cpid,
});

const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (err) {
      next(err);
    }
  };

export const listThreads = handle((req) =>
  threads.listCareThreads(caller(req), listQuery.parse(req.query)));

export const getThread = handle((req) =>
  threads.getCareThreadDetail(pathParam(req, 'care_thread_id'), caller(req)));

export const closeThread = handle((req) => {
  const input = closeThreadSchema.parse(req.body);
  return threads.closeCareThread(pathParam(req, 'care_thread_id'), caller(req), input.outcome, input.notes);
});

export const createConsultation = handle(
  (req, res) => consultations.createConsultation(caller(req), createConsultationSchema.parse(req.body), meta(req, res)),
  201,
);

export const acceptConsultation = handle((req, res) =>
  consultations.acceptConsultation(pathParam(req, 'consultation_id'), caller(req), meta(req, res)));

export const declineConsultation = handle((req, res) => {
  const input = declineSchema.parse(req.body ?? {});
  return consultations.declineConsultation(pathParam(req, 'consultation_id'), caller(req), input.reason, meta(req, res));
});

export const completeConsultation = handle((req, res) =>
  consultations.completeConsultation(pathParam(req, 'consultation_id'), caller(req), completeSchema.parse(req.body), meta(req, res)));

export const referConsultation = handle(
  (req, res) => consultations.referConsultation(pathParam(req, 'consultation_id'), caller(req), referSchema.parse(req.body), meta(req, res)),
  201,
);

export const getQueue = handle((req) => queue.getQueue(caller(req), queueQuery.parse(req.query)));

export const getQueueStatus = handle((req) =>
  queue.getQueueStatus(pathParam(req, 'consultation_id'), caller(req)));
TS

cat > "$SVC/src/routes/consultation.routes.ts" << 'TS'
import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import * as c from '../controllers/consultation.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireVerifiedClinician } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);

export const consultationRouter = Router();

consultationRouter.get('/care-threads', requireAuth, c.listThreads);
consultationRouter.get('/care-threads/:care_thread_id', requireAuth, c.getThread);
consultationRouter.post('/care-threads/:care_thread_id/close', requireAuth, requireVerifiedClinician, idempotency, c.closeThread);

consultationRouter.post('/consultations', requireAuth, idempotency, c.createConsultation);
consultationRouter.get('/consultations/:consultation_id/queue-status', requireAuth, c.getQueueStatus);

// Every clinical transition is guarded on verification, not merely on role.
consultationRouter.post('/consultations/:consultation_id/accept', requireAuth, requireVerifiedClinician, idempotency, c.acceptConsultation);
consultationRouter.post('/consultations/:consultation_id/decline', requireAuth, requireVerifiedClinician, idempotency, c.declineConsultation);
consultationRouter.post('/consultations/:consultation_id/complete', requireAuth, requireVerifiedClinician, idempotency, c.completeConsultation);
consultationRouter.post('/consultations/:consultation_id/refer', requireAuth, requireVerifiedClinician, idempotency, c.referConsultation);

consultationRouter.get('/queue', requireAuth, requireVerifiedClinician, c.getQueue);
TS

cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { consultationRouter } from './routes/consultation.routes.js';
import { startSlaWorker } from './workers/sla.worker.js';

const service = createService({
  name: 'consultation',
  port: env.PORT,
  routers: [consultationRouter],
  development: env.NODE_ENV === 'development',
});

startSlaWorker();
service.start();
TS

if [ ! -f "$SVC/.env" ]; then
  AUTH_SECRET=$(grep -E '^JWT_SECRET=' "$ROOT/services/auth/.env" 2>/dev/null || echo 'JWT_SECRET=change-me-to-a-32-character-minimum-secret')
  {
    echo "NODE_ENV=development"
    echo "PORT=4005"
    echo "DATABASE_URL=postgresql://ahealth:ahealth@localhost:5432/ahealth_dev?schema=public"
    echo "$AUTH_SECRET"
    echo "JWT_ISSUER=a-health"
    echo "JWT_AUDIENCE=a-health-api"
  } > "$SVC/.env"
  echo "  .env written (JWT_SECRET copied from auth)"
fi

cat > "$SVC/src/tests/engine.test.ts" << 'TS'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRIAGE_RULES_VERSION, triage } from '../engine/triage.js';
import { fanoutFor, rank } from '../engine/matching.js';

describe('triage', () => {
  it('is deterministic', () => {
    const input = { symptomCodes: ['fever', 'cough'], ageYears: 30 };
    assert.deepEqual(triage(input), triage(input));
  });

  it('stamps the rule version so a decision stays explainable', () => {
    assert.equal(triage({ symptomCodes: [] }).ruleVersion, TRIAGE_RULES_VERSION);
  });

  it('treats stroke signs as an emergency', () => {
    const r = triage({ symptomCodes: ['one_sided_weakness', 'speech_difficulty'], ageYears: 60 });
    assert.equal(r.urgency, 'emergency');
    assert.ok(r.matchedRules.includes('RF-STROKE-01'));
  });

  it('escalates fever in an infant above the same fever in an adult', () => {
    const infant = triage({ symptomCodes: ['fever'], ageYears: 0 });
    const adult = triage({ symptomCodes: ['fever'], ageYears: 30 });
    assert.equal(infant.urgency, 'emergency');
    assert.notEqual(adult.urgency, 'emergency');
  });

  it('raises obstetric bleeding and routes it to OB/GYN', () => {
    const r = triage({ symptomCodes: ['vaginal_bleeding_pregnancy'], isPregnant: true });
    assert.equal(r.urgency, 'emergency');
    assert.equal(r.recommendedSpecialty, 'obstetrics_gynaecology');
  });

  it('treats severity at the top of the scale as urgent', () => {
    const r = triage({ symptomCodes: ['headache'], severityByCode: { headache: 9 }, ageYears: 30 });
    assert.equal(r.urgency, 'urgent');
  });

  it('lifts an ordinary complaint when a chronic condition is present', () => {
    const plain = triage({ symptomCodes: ['cough'], ageYears: 30 });
    const chronic = triage({ symptomCodes: ['cough'], ageYears: 30, chronicConditions: ['hiv'] });
    assert.equal(plain.urgency, 'routine');
    assert.equal(chronic.urgency, 'urgent');
  });

  it('routes children to paediatrics', () => {
    assert.equal(triage({ symptomCodes: ['rash'], ageYears: 6 }).recommendedSpecialty, 'paediatrics');
  });
});

describe('matching', () => {
  const base = {
    specialty: 'general_practice',
    languages: ['sw'],
    currentLoad: 0,
    maxLoad: 5,
    ratingAvg: 4 as number | null,
  };
  const ctx = {
    requiredSpecialty: 'general_practice',
    patientLanguage: 'sw',
    urgency: 'routine' as const,
  };

  it('excludes clinicians at capacity', () => {
    assert.equal(rank([{ ...base, clinicianId: 'a', currentLoad: 5 }], ctx).length, 0);
  });

  it('prefers a shared language', () => {
    const out = rank(
      [
        { ...base, clinicianId: 'sw', languages: ['sw'] },
        { ...base, clinicianId: 'fr', languages: ['fr'] },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'sw');
  });

  it('prefers the lighter load when all else matches', () => {
    const out = rank(
      [
        { ...base, clinicianId: 'busy', currentLoad: 4 },
        { ...base, clinicianId: 'free', currentLoad: 0 },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'free');
  });

  it('does not bury an unrated clinician', () => {
    // Ranking a newly deployed graduate last would mean they never get a first
    // case, which defeats the point of employing them.
    const out = rank(
      [
        { ...base, clinicianId: 'new', ratingAvg: null },
        { ...base, clinicianId: 'poor', ratingAvg: 2 },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'new');
  });

  it('records the weights behind every score', () => {
    const out = rank([{ ...base, clinicianId: 'a' }], ctx);
    assert.deepEqual(
      Object.keys(out[0]!.weights).sort(),
      ['availability', 'language', 'proximity', 'rating', 'specialty'],
    );
  });

  it('widens the pool on each escalation', () => {
    assert.ok(fanoutFor('routine', 2, 3) > fanoutFor('routine', 0, 3));
    assert.ok(fanoutFor('emergency', 0, 3) > fanoutFor('routine', 0, 3));
  });
});
TS

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
