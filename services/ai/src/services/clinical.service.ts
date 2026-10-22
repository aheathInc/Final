import { prisma } from '@a-health/database';
import type { TranscribeAdapter } from '../adapters/transcribe.js';

/**
 * Advisory triage support. This suggestion is a second, separate input to the
 * consultation service's deterministic rules engine — it never sets urgency
 * on its own, and the two are reconciled by the more-urgent-wins rule
 * documented in services/consultation. `advisory_only: true` is always
 * present on the wire, so no client can mistake this for a decision.
 */
export async function suggestTriage(input: {
  symptom_text?: string;
  structured_symptoms?: { code: string; severity?: number }[];
}) {
  const codes = (input.structured_symptoms ?? []).map((s) => s.code.toLowerCase());
  const text = (input.symptom_text ?? '').toLowerCase();

  const EMERGENCY_TERMS = ['chest pain', 'unconscious', 'severe bleeding', 'can\u2019t breathe', 'stroke'];
  const hit = EMERGENCY_TERMS.find((t) => text.includes(t)) ?? codes.find((c) => EMERGENCY_TERMS.some((t) => c.includes(t.split(' ')[0]!)));

  const suggestedUrgency = hit ? 'emergency' : codes.length > 0 ? 'urgent' : 'routine';

  return {
    suggested_urgency: suggestedUrgency,
    confidence: hit ? 0.7 : 0.4,
    red_flags: hit ? [hit] : [],
    recommended_department: null,
    rationale: hit
      ? `Free text or symptom codes matched a known emergency pattern: "${hit}".`
      : 'No emergency pattern matched; deferring to the deterministic triage engine.',
    model_version: 'stub-1',
    advisory_only: true,
  };
}

/**
 * Clinician-facing drug interaction check.
 *
 * A tiny hard-coded table stands in for a pharmacology model here — the point
 * of this pass is the request/response shape and the audit trail, not
 * interaction coverage. Swapping in a real model changes only findInteractions.
 */
const KNOWN_INTERACTIONS: { pair: [string, string]; severity: string; description: string }[] = [
  { pair: ['warfarin', 'aspirin'], severity: 'major', description: 'Increased bleeding risk when combined.' },
  { pair: ['metformin', 'contrast dye'], severity: 'moderate', description: 'Risk of lactic acidosis around imaging with IV contrast.' },
  { pair: ['ace inhibitor', 'potassium supplement'], severity: 'moderate', description: 'Risk of hyperkalaemia.' },
];

export async function checkDrugInteractions(medications: string[]) {
  const lower = medications.map((m) => m.toLowerCase());
  const findings = KNOWN_INTERACTIONS
    .filter(({ pair }) => lower.some((m) => m.includes(pair[0])) && lower.some((m) => m.includes(pair[1])))
    .map(({ pair, severity, description }) => ({
      medications: pair,
      severity,
      description,
      source: 'internal-reference-table-v1',
    }));

  return { findings, model_version: 'stub-1' };
}

export async function transcribeAudio(
  audioKey: string,
  language: string,
  adapter: TranscribeAdapter,
) {
  const result = await adapter.transcribe(audioKey, language);
  return {
    text: result.text,
    confidence: result.confidence,
    language,
    model_version: result.modelVersion,
  };
}

export async function synthesizeSpeech(text: string, _language: string) {
  // No TTS engine wired yet; returns a stable placeholder key so the client
  // contract (an object key it fetches, not inline audio) is already correct
  // for when Piper is connected.
  return { audio_key: 'pending/' + Buffer.from(text.slice(0, 40)).toString('base64url'), duration_seconds: null };
}

export async function listModels() {
  const { listModels: list } = await import('./registry.js');
  return list();
}
