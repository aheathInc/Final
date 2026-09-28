import { prisma } from '@a-health/database';
import { CONSULTATION_VOLUMES } from '../engine/datasets.js';

export async function seedDatasets(): Promise<{ inserted: number; skipped: number }> {
  const existing = await prisma.researchDataset.findUnique({ where: { name: CONSULTATION_VOLUMES.datasetName } });
  if (existing) return { inserted: 0, skipped: 1 };

  await prisma.researchDataset.create({
    data: {
      name: CONSULTATION_VOLUMES.datasetName,
      description: 'Counts of consultations grouped by urgency level, channel, and status. No patient-identifying field is queryable.',
      deidentificationMethod: 'aggregation-only; no row-level export',
      kAnonymity: 5,
      minimumCellSize: 5,
      requiresEthicsApproval: true,
    },
  });
  return { inserted: 1, skipped: 0 };
}
