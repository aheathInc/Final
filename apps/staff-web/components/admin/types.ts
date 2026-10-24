/** Response contract for platform-admin-only Surveillance analytics endpoint. */
export interface AdminAnalyticsReport {
  source: 'A-Health operational records';
  scope: 'platform';
  periodDays: 30 | 90 | 365;
  generatedAt: string;
  privacy: { minCell: number; rule: string };
  coverage: { patientProfiles: string; facilities: number; consultationRequests: string; signedNotesInPeriod: string };
  regions: PublishedCount[];
  genders: PublishedCount[];
  ages: PublishedCount[];
  conditions: PublishedCount[];
  monthlyConsultations: PublishedCount[];
}
export interface PublishedCount { label: string; count: number | null; suppressed: boolean }
