/** Public response policy for population-level administrative charts.
 * Never expose a raw small-cell count. These charts are descriptive of AHP
 * records only, not population prevalence or epidemiological incidence.
 */
export const MIN_PUBLIC_CELL = 10;
export const REPORT_DAYS = [30, 90, 365] as const;
export type ReportDays = (typeof REPORT_DAYS)[number];

export function parseReportDays(value: unknown): ReportDays {
  if (value === undefined) return 90;
  if (typeof value !== 'string' || !['30', '90', '365'].includes(value)) {
    throw new Error('INVALID_REPORT_WINDOW');
  }
  return Number(value) as ReportDays;
}

export interface PrivateCount { label: string; count: number }
export interface PublishedCount { label: string; count: number | null; suppressed: boolean }

export function publishCounts(rows: PrivateCount[], maxRows = 20): PublishedCount[] {
  return rows
    .filter((r) => typeof r.label === 'string' && Number.isSafeInteger(r.count) && r.count >= 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, maxRows)
    .map(({ label, count }) => ({ label, count: count >= MIN_PUBLIC_CELL ? count : null, suppressed: count > 0 && count < MIN_PUBLIC_CELL }));
}

/** Deliberately do not send an exact patient total alongside suppressed cells. */
export function patientTotalBand(count: number): string {
  if (count === 0) return 'No records';
  if (count < MIN_PUBLIC_CELL) return 'Under 10';
  const lower = Math.floor(count / MIN_PUBLIC_CELL) * MIN_PUBLIC_CELL;
  return `${lower}–${lower + MIN_PUBLIC_CELL - 1}`;
}
