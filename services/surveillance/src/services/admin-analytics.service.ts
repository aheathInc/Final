import { prisma } from '@a-health/database';
import { forbidden } from '@a-health/http';
import { patientTotalBand, publishCounts, type PrivateCount, type ReportDays } from './admin-analytics.policy.js';

export interface AdminAnalyticsReport {
  source: 'A-Health operational records';
  scope: 'platform';
  periodDays: ReportDays;
  generatedAt: string;
  privacy: { minCell: number; rule: string };
  coverage: { patientProfiles: string; facilities: number; consultationRequests: string; signedNotesInPeriod: string };
  regions: ReturnType<typeof publishCounts>;
  genders: ReturnType<typeof publishCounts>;
  ages: ReturnType<typeof publishCounts>;
  conditions: ReturnType<typeof publishCounts>;
  monthlyConsultations: ReturnType<typeof publishCounts>;
}

type Row = { label: string; count: bigint | number };
const numberRows = (rows: Row[]): PrivateCount[] => rows.map((r) => ({ label: r.label, count: Number(r.count) }));

/** Platform-wide aggregate view; never returns patient IDs, notes, birth dates or free text. */
export async function getAdminAnalytics(role: string, days: ReportDays): Promise<AdminAnalyticsReport> {
  if (role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Platform analytics requires platform administrator privileges');
  }
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);

  const [profileCount, facilityCount, consultationCount, signedCount, regionGroups, genderGroups, ageRows, monthRows] = await Promise.all([
    prisma.patientProfile.count(),
    prisma.facility.count(),
    prisma.consultationRequest.count({ where: { createdAt: { gte: from } } }),
    prisma.consultationNote.count({ where: { signedAt: { gte: from } } }),
    prisma.patientProfile.groupBy({ by: ['regionCode'], _count: { _all: true } }),
    prisma.patientProfile.groupBy({ by: ['sex'], _count: { _all: true } }),
    prisma.$queryRaw<Row[]>`
      SELECT CASE
        WHEN date_of_birth IS NULL OR date_of_birth > CURRENT_DATE THEN 'Not recorded'
        WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth)) < 18 THEN '0–17'
        WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth)) < 35 THEN '18–34'
        WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth)) < 50 THEN '35–49'
        WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth)) < 65 THEN '50–64'
        ELSE '65+'
      END AS label, COUNT(*)::bigint AS count
      FROM patient_profiles GROUP BY 1
    `,
    prisma.$queryRaw<Row[]>`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS label,
             COUNT(*)::bigint AS count
      FROM consultation_requests
      WHERE created_at >= ${from}
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at) ASC
    `,
  ]);

  return {
    source: 'A-Health operational records',
    scope: 'platform', periodDays: days, generatedAt: now.toISOString(),
    privacy: { minCell: 10, rule: 'Small nonzero cells below 10 are suppressed. Patient totals are banded. No patient-level records are exposed.' },
    coverage: {
      patientProfiles: patientTotalBand(profileCount),
      facilities: facilityCount,
      consultationRequests: patientTotalBand(consultationCount),
      signedNotesInPeriod: patientTotalBand(signedCount),
    },
    regions: publishCounts(regionGroups.map((r) => ({ label: r.regionCode?.trim() || 'Not recorded', count: r._count._all }))),
    genders: publishCounts(genderGroups.map((r) => ({ label: r.sex ?? 'Not recorded', count: r._count._all }))),
    ages: publishCounts(numberRows(ageRows)),
    // Avoid live disease totals that could undo the new monthly release suppression.
    conditions: [],
    monthlyConsultations: publishCounts(numberRows(monthRows)).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
