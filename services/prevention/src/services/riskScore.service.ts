import { prisma } from '@a-health/database';
import { forbidden, notFound } from '@a-health/http';
import { MODEL_VERSION, SUPPORTED_CONDITIONS, scoreCondition, type SupportedCondition } from '../engine/riskScoring.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }

function serialise(r: { id: string; conditionCode: string; score: number; band: string; contributingFactors: unknown; modelVersion: string; computedAt: Date }) {
  return {
    id: r.id,
    condition_code: r.conditionCode,
    score: r.score,
    band: r.band,
    contributing_factors: r.contributingFactors,
    model_version: r.modelVersion,
    computed_at: r.computedAt.toISOString(),
  };
}

async function assertVisible(patientProfileId: string, caller: Caller) {
  if (caller.role === 'platform_admin' || caller.cpid) return;
  const patient = await prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view risk scores for this patient');
  }
}

export async function listRiskScores(patientProfileId: string, caller: Caller) {
  await assertVisible(patientProfileId, caller);
  const rows = await prisma.riskScore.findMany({ where: { patientProfileId }, orderBy: { computedAt: 'desc' } });
  return { data: rows.map(serialise) };
}

/**
 * Recomputes and stores a fresh score per requested condition, restricted to
 * the small supported set — an unsupported condition_code is silently
 * skipped, never faked with a placeholder number.
 */
export async function computeRiskScores(patientProfileId: string, caller: Caller, conditions?: string[]) {
  await assertVisible(patientProfileId, caller);

  const requested = (conditions && conditions.length > 0 ? conditions : SUPPORTED_CONDITIONS)
    .filter((c): c is SupportedCondition => SUPPORTED_CONDITIONS.includes(c as SupportedCondition));

  const results: ReturnType<typeof serialise>[] = [];
  for (const condition of requested) {
    const result = await scoreCondition(patientProfileId, condition);
    if (!result) continue;
    const row = await prisma.riskScore.upsert({
      where: { patientProfileId_conditionCode: { patientProfileId, conditionCode: condition } },
      create: {
        patientProfileId, conditionCode: condition, score: result.score, band: result.band as never,
        contributingFactors: result.factors as never, modelVersion: MODEL_VERSION,
      },
      update: {
        score: result.score, band: result.band as never, contributingFactors: result.factors as never,
        modelVersion: MODEL_VERSION, computedAt: new Date(), version: { increment: 1 },
      },
    });
    results.push(serialise(row));
  }
  return { data: results };
}
