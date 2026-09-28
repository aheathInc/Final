import { prisma } from '@a-health/database';

const PROGRAMMES = [
  { code: 'CERVICAL', name: 'Cervical cancer screening', conditionCode: 'CERVICAL_CA', intervalMonths: 36 },
  { code: 'BREAST', name: 'Breast cancer screening', conditionCode: 'BREAST_CA', intervalMonths: 24 },
  { code: 'HYPERTENSION', name: 'Hypertension screening', conditionCode: 'HYPERTENSION', intervalMonths: 12 },
  { code: 'DIABETES', name: 'Diabetes screening', conditionCode: 'TYPE2_DIABETES', intervalMonths: 12 },
  { code: 'TB', name: 'Tuberculosis screening', conditionCode: 'TB', intervalMonths: 12 },
];

export async function seedProgrammes(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0, skipped = 0;
  for (const p of PROGRAMMES) {
    const existing = await prisma.screeningProgramme.findUnique({ where: { code: p.code } });
    if (existing) { skipped += 1; continue; }
    await prisma.screeningProgramme.create({ data: { ...p, eligibility: {} } });
    inserted += 1;
  }
  return { inserted, skipped };
}
