# A-Health Phase 2 Staging Acceptance Results — 2026-10-24

## Scope and safety

- **Branch / source:** `feat/unified-all-updates-2026-10-24` at `5dedc611c4adb27ec7120c6e905de67a6d495d31`.
- **Staging server:** independent PostgreSQL 17.11 cluster bound only to `127.0.0.1:55439`, data directory `%LOCALAPPDATA%\AHP-Staging-20261024\data` (PID 9052 at final check).
- **Staging database:** `ahealth_test`. It is on the newly initialized cluster, not on the existing PostgreSQL instance.
- **Existing PostgreSQL:** port 5432 remained on its original process (PID 7936). No connections or changes were made to it. Port 55432 was not listening.
- **Staging access:** the migrator role can connect to `ahealth_test`; it cannot connect to `postgres`, `template0`, or `template1`. The restriction was verified after revoking the default `PUBLIC` connect right on `template0` in the isolated cluster. Credentials are stored outside the repository with a current-user-only ACL.
- **Data:** all acceptance records are synthetic. Staging rows and schemas are intentionally retained. No real SMS, payment, wallet, production service, or patient record was used.
- **Git:** no commit, push, merge, reset, or cleanup was performed. This report and the five source/test changes listed below are uncommitted. Pre-existing generated registrant changes and untracked artifacts remain untouched.

## Database migrations

All **25 Prisma migrations** were applied to each of these seven schemas in `ahealth_test`:

1. `public`
2. `ahp_test_front_desk_20261024`
3. `ahp_test_thread_integrity_20261024`
4. `ahp_test_payment_20261024`
5. `ahp_test_gateway_20261024`
6. `ahp_test_surveillance_20261024`
7. `ahp_test_research_portal_20261024`

For all seven, Prisma `migrate status` reported **up to date**. Every recorded migration checksum matched the corresponding local `migration.sql` file (25/25 per schema, zero mismatches). Each migrated schema has 104 tables and 211 validated foreign keys, with no unvalidated foreign keys. `prisma validate` passed. The separately owned `ahp_omop_stage_20261024` and `ahp_vocab_stage_20261024` schemas are present and empty; OMOP provisioning was not run there.

One historical migration removes the `deliver_after` column from `otp_challenges`. It succeeded on these newly created empty schemas. Review its data impact before applying the migration history to any database containing existing records.

## Acceptance results

| Area | Result | Evidence |
|---|---|---|
| Auth and OTP database tests | **PASS — 32/32** | `auth-database-tests-final.log`; includes concurrent challenge consumption and rolling-hour quota checks. |
| Digital Front Desk database tests | **PASS — 12/12** | `front-desk-database-tests-retry.log`. |
| Consultation thread integrity | **PASS — 9/9** | `thread-integrity-database-tests.log`. |
| Payment database tests | **PASS — 14/14** | `payment-database-tests.log`; provider adapter is simulated; no charge or refund was sent. |
| USSD/gateway database tests | **PASS — 9/9** | `gateway-database-tests.log`; exercises OTP gate, encrypted session, replay/idempotency, expiry, and role token. |
| Surveillance database tests | **PASS — 6/6** | `surveillance-database-tests.log`. |
| Admin Executive Analytics database acceptance | **PASS** | `admin-analytics-database-acceptance.log`; synthetic cohort verifies role denial, small-cell suppression, banded totals, and no person identifiers in output. |
| Research Portal/eCRF database acceptance | **PASS** | `research-portal-ecrf-database-acceptance-final3.log`; synthetic source approval, ingestion, independent release, authorization, reviewed export, encrypted eCRF, aggregate review, download, and row-level denial. |
| Offline verification suite | **PASS — 623/623** | `verification-source-tests-final.log`. |
| Research package tests | **PASS — 16 passed, 0 failed, 1 skipped** | `research-database-tests.log`; the skipped test requires a separate OMOP warehouse database. |
| `git diff --check` | **PASS** | Final check had no whitespace errors. Git emitted only line-ending normalization warnings. |
| Gitleaks 8.30.1 on the five edited source/test files | **PASS — 0 findings** | Exact-file report `gitleaks-edited-files.json` contains an empty finding list. The five files were unchanged after that scan. The final environment no longer resolves the `gitleaks` executable, so the scan was not rerun. |
| Prisma schema validation | **PASS** | `prisma validate` completed successfully. |
| Staff Web/backend builds and Flutter checks | **PASS, carried forward** | Earlier Phase 1 evidence: 25/25 backend TypeScript builds, 4/4 Web builds, 136 Flutter tests, and debug/release APK builds. Flutter analyzer had zero errors and warnings, with 56 informational findings. These were not rerun during this staging phase. |

All payment, OTP, quota, gateway, and research integration checks ran against the isolated staging database with simulation adapters or synthetic data. No provider credentials were used.

## Not run / blocked

- **Live OMOP PostgreSQL acceptance — BLOCKED by approved scope.** The package's dedicated warehouse test requires another database named `ahealth_research_test` and deliberately rejects using an operational database as the warehouse. Only `ahealth_test` on the new instance was authorized. The dedicated test was skipped; no bypass or second database was created. OMOP SQL adapter, catalog, and data-contract tests ran, but warehouse ETL and database constraints are not accepted as live-tested.
- **Running all 25 services and Web HTTP routes — NOT RUN.** No service was listening on the expected local ports at final inspection; this phase did not start the full platform stack. Build results above are source-build evidence, not live health checks.
- **Physical Android device / Flutter-to-backend acceptance — NOT RUN.** No live device session was used in this phase.
- **Live carrier SMS/USSD and payment provider callback/reconciliation — NOT RUN.** They require external sandbox accounts or services; only local simulation and database paths were exercised.

## Source changes made in this phase

Five source/test files were changed to make test-target safeguards support explicitly named `ahp_test_*` schemas on the approved isolated server and to add real PostgreSQL concurrency tests for one-time OTP consumption and rolling-hour quota enforcement:

- `packages/database/src/test-safety.ts`
- `services/consultation/src/tests/safety-test-target.ts`
- `services/auth/src/tests/auth.test.ts`
- `verification/test-target-guard.test.cjs`
- `verification/followup-test-target-guard.test.cjs`

The full diff is limited to 43 insertions and 3 deletions across these five files. Existing safety guards still require test mode, loopback, an explicitly configured non-5432 port, the exact approved database, and an owned test schema.

## Preserved staging evidence

Logs and generated test harness evidence are under `%LOCALAPPDATA%\AHP-Staging-20261024\`. They include the per-suite logs named above and `research-portal-ecrf-acceptance.mjs`. The PostgreSQL cluster, synthetic rows, schemas, and local-only credential files remain in place for review. No cleanup was performed.

## Tool versions

- Node.js `v25.9.0`
- pnpm `10.34.4`
- Flutter `3.47.4` stable
- PostgreSQL `17.11`

