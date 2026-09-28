import { prisma } from '@a-health/database';
import { forbidden } from '@a-health/http';

export interface Caller { role: string }

function assertPrivileged(caller: Caller) {
  if (caller.role !== 'platform_admin' && caller.role !== 'clinician') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Aggregate surveillance data is not available to this role');
  }
}

/**
 * Ranked, aggregated only — this is population-level reporting, never a
 * per-patient view. Reads what the rollup worker has actually computed; an
 * area with no data returns an empty list, not a fabricated one.
 */
export async function getConditions(
  caller: Caller, query: { level: string; area_code?: string; from?: string; to?: string },
) {
  assertPrivileged(caller);

  const rows = await prisma.surveillanceRollup.groupBy({
    by: ['conditionCode', 'conditionName'],
    where: {
      level: query.level as never,
      ...(query.area_code ? { areaCode: query.area_code } : {}),
      ...(query.from || query.to
        ? { periodStart: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
    take: 20,
  });

  return {
    data: rows.map((r, i) => ({
      condition_code: r.conditionCode,
      condition_name: r.conditionName,
      count: r._sum.count ?? 0,
      rate_per_100k: null,
      rank: i + 1,
      change_percent: null,
    })),
  };
}

/**
 * `expected_low`/`expected_high`/`above_expected` are always null/false
 * here — a real outbreak-detection band needs a forecasting model (Prophet,
 * still `not_deployed` in the AI registry), and this endpoint does not
 * fabricate one in its absence. What it returns is the honest daily count.
 */
export async function getTrends(
  caller: Caller,
  query: { condition_code: string; level: string; area_code?: string; from?: string; to?: string },
) {
  assertPrivileged(caller);

  const rows = await prisma.surveillanceRollup.findMany({
    where: {
      conditionCode: query.condition_code,
      level: query.level as never,
      ...(query.area_code ? { areaCode: query.area_code } : {}),
      ...(query.from || query.to
        ? { periodStart: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    orderBy: { periodStart: 'asc' },
  });

  return {
    condition_code: query.condition_code,
    level: query.level,
    area_code: query.area_code ?? null,
    points: rows.map((r) => ({
      period: r.periodStart.toISOString().slice(0, 10),
      count: r.count,
      expected_low: r.expectedLow,
      expected_high: r.expectedHigh,
      above_expected: r.aboveExpected,
    })),
    model_version: null,
  };
}
