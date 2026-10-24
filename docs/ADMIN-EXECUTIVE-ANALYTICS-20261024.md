# A-Health Admin Executive Analytics — 24 October 2026

## Delivered

- `GET /surveillance/admin-analytics?days=30|90|365` on the existing Surveillance service (port 4020), protected by JWT authentication and a **platform_admin-only** service-level role check.
- Staff Web `/admin/dashboard` now displays a responsive premium analytics section with:
  - Patient profile count **band** (not exact), facility count, period consultation requests, period signed notes.
  - Region-code distribution of patient profiles (mikoa), recorded sex distribution, age bands, coded diagnoses from signed notes, and monthly consultation request trends.
  - Reporting window controls (30, 90, 365 days) for clinical activity. Demographics remain all-time.
  - Source timestamp, unavailable-state messages, data provenance and disclosure warnings.
- Modern AHP petrol/mint gradient cards, accessible labels, responsive grids, reduced-motion support. No fake values, patient-level payloads or hardcoded statistics.

## Privacy and interpretation

- The endpoint never returns patient names, identifiers, date of birth, raw diagnoses or free-text clinical notes.
- Nonzero group counts **under 10** are replaced with `null` and `suppressed=true`; profile totals are returned as bands of ten. This is an initial disclosure control, **not a guarantee of anonymization**. Small groups should undergo formal disclosure-risk assessment before sharing beyond trusted platform administrators.
- A region code is shown as recorded; unknown regions remain `Not recorded`. No coordinates or street addresses are used.
- Age is computed from DOB at query time and bucketed as `0–17`, `18–34`, `35–49`, `50–64`, `65+` and `Not recorded`.
- Diagnosis counts represent **signed notes containing each code**, not distinct patients, population prevalence or confirmed outbreak rates.
- Gender chart reflects the existing `PatientProfile.sex` field, not a separate gender identity field.
- Existing Admin Layout admits facility_admin/dispatcher for operational pages, but **the new population analytics is rendered only for platform_admin and is independently protected at the API**. A hospital-scoped analytics endpoint would require explicit facility-scoped aggregation and a separate authorization design.

## Data sources

- `patient_profiles`: all-time region, sex and DOB distributions.
- `facilities`: registered facility count.
- `consultation_requests`: period count and monthly request volume.
- `consultation_notes`: period signed note count and coded diagnoses only.

## Integration and validation

- Existing Prisma schema reused; **no new migration** and no database writes.
- Unit tests for window validation, suppression and patient-count banding are in `services/surveillance/src/tests/admin-analytics.policy.test.ts`.
- Unit tests and TypeScript/TSX parse validation passed in this environment. **No live PostgreSQL, full Next.js build, service build, authenticated browser test or deployment has been run here.** These are required before production use.
- For local verification on an approved isolated staging DB: install locked dependencies, generate Prisma Client, run surveillance tests and build, run Staff Web build, then sign in as platform_admin and open `/admin/dashboard?days=90`. Confirm that facility_admin cannot access `/surveillance/admin-analytics` directly.
- Confirm the existing database has `patient_profiles.region_code`, `patient_profiles.date_of_birth`, `consultation_notes.diagnosis_codes` and signed timestamps before enabling in a deployed environment.

## Next improvements

- Approved region code-to-name mapping and data quality validation.
- True facility-scoped statistics with explicit permissions.
- Epidemiological rates require a defined denominator, coding quality and a validated surveillance methodology; these are not fabricated by this dashboard.
- Formal privacy risk testing for repeated queries and multiple time windows.
