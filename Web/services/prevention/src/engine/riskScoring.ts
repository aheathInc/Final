import { prisma } from '@a-health/database';

/**
 * Two real, deterministic rule-based scorers — not a claimed ML model. Same
 * honest-scope discipline as research's one real dataset: a score nobody can
 * interrogate cannot be acted on responsibly, so every score here carries
 * exactly the factors that produced it, computed by a function anyone can
 * read start to finish.
 *
 * A condition requested outside this pair is simply not scored — no
 * fabricated number, no silent substitution.
 */
export type SupportedCondition = 'hypertension' | 'type2_diabetes';
export const SUPPORTED_CONDITIONS: SupportedCondition[] = ['hypertension', 'type2_diabetes'];
export const MODEL_VERSION = 'rule-based-v1';

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 86_400_000));
}

interface ScoreResult { score: number; band: 'low' | 'moderate' | 'high' | 'very_high'; factors: Record<string, unknown> }

function bandFor(score: number): ScoreResult['band'] {
  if (score >= 0.75) return 'very_high';
  if (score >= 0.5) return 'high';
  if (score >= 0.25) return 'moderate';
  return 'low';
}

async function priorDiagnosisCount(patientProfileId: string, codePrefixes: string[]): Promise<number> {
  const notes = await prisma.consultationNote.findMany({
    where: { consultation: { patientProfileId } },
    select: { diagnosisCodes: true },
  });
  let count = 0;
  for (const note of notes) {
    const codes = Array.isArray(note.diagnosisCodes) ? (note.diagnosisCodes as string[]) : [];
    if (codes.some((c) => codePrefixes.some((prefix) => c.toUpperCase().startsWith(prefix)))) count += 1;
  }
  return count;
}

export async function scoreCondition(patientProfileId: string, condition: SupportedCondition): Promise<ScoreResult | null> {
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) return null;
  const age = ageFromDob(patient.dateOfBirth);

  if (condition === 'hypertension') {
    const priorCount = await priorDiagnosisCount(patientProfileId, ['I10', 'HTN']);
    const ageComponent = age === null ? 0 : Math.min(age / 80, 1) * 0.5;
    const historyComponent = Math.min(priorCount / 3, 1) * 0.5;
    const score = ageComponent + historyComponent;
    return {
      score: Math.round(score * 100) / 100,
      band: bandFor(score),
      factors: { age, prior_diagnosis_count: priorCount, age_component: ageComponent, history_component: historyComponent },
    };
  }

  // type2_diabetes
  const priorCount = await priorDiagnosisCount(patientProfileId, ['E11', 'DM2']);
  const ageComponent = age === null ? 0 : Math.min(Math.max(age - 30, 0) / 50, 1) * 0.4;
  const historyComponent = Math.min(priorCount / 2, 1) * 0.6;
  const score = ageComponent + historyComponent;
  return {
    score: Math.round(score * 100) / 100,
    band: bandFor(score),
    factors: { age, prior_diagnosis_count: priorCount, age_component: ageComponent, history_component: historyComponent },
  };
}
