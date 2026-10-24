# Unified candidate integration — 24 October 2026

Status: source integration and offline validation complete; database and live acceptance remain blocked pending owner-approved staging. This is not production deployment approval.

## Source and preservation

- Authoritative workspace: `C:\Projects\A-Health`.
- Integration branch: `feat/unified-all-updates-2026-10-24`.
- Starting commit: `77f4158830afa8a1b4df6223a97c0d57e9f66d6a`.
- Backup branch: `backup/pre-unified-integration-20261024`, at the starting commit.
- Database safety commit `60c8e1a`, Patient Premium UI commits `1bc17e9` and `8a07a7a`, and Research RC2 commit `77f4158` remain ancestors.
- Candidate: `AHP_Unified_All_Updates_Full_Project_20261024.zip`.
- Candidate SHA-256: `5368c648a8705812a1416bce9cfa2346b39afdaca308358ffcb77839010edac4`.
- Archive paths, extraction and manifest verification passed: 1,204 archive files; all 1,203 entries in the self-excluding source manifest matched. No unsafe paths, duplicates or symlinks were identified.
- Comparison normalized CRLF/LF before judging substantive conflicts. Raw byte differences alone were not treated as new functionality.
- No source file deletions. The previously modified desktop Flutter registrants were excluded from integration commits and could regenerate during the requested Flutter checks. The owner's unrelated untracked artifacts remain outside the commits.
- Patient palette, Premium widgets, offline SQLite, API host configuration, authentication destinations, Staff shell and clinical styles were retained. Existing Family and clinical workflows were not replaced by the candidate snapshot.

## Integrated behavior

| Area | Result |
| --- | --- |
| OTP and SMS | Shared bounded SMS adapter; explicit simulation, HTTP bridge and Africa's Talking modes. Delivery failures invalidate challenges. OTP quota and consumption/session creation use transactional locking. Existing password and account/profile workflows retained. |
| Notifications | Shared adapter and privacy-conscious templates; verified and simulated payment messages are distinct. Provider acceptance is not represented as handset delivery. |
| USSD | Timestamped HMAC bridge requests, encrypted session context, phone/session binding, OTP before patient access, replay handling and existing service API routing. Inbound clinical SMS writes remain disabled in production. |
| Payments | Server-issued consultation bills; payer ownership; server-controlled price; Flutter bills and wallet selection; Staff bill issuance/listing; authoritative provider lookup before settlement; explicit simulation; reconciliation and restricted refunds. |
| Research Portal | Existing RC2 portal, governance, OMOP ETL and eCRF analytics preserved. Researcher landing/navigation now reach the governed portal. Legacy unchecked clinical aggregation/results are denied. BFF mutations require same origin and returned data is non-cacheable. |
| OMOP / eCRF | Added missing pinned CDM SQL/catalog, vocabulary manifest utility, API contract and offline regression suites. Kept the current warehouse SQL parameter typing and current compatibility fixes rather than restoring older candidate variants. |
| Executive analytics | Platform-admin endpoint and Premium dashboard panels. Small groups suppressed; patient and clinical coverage totals banded to avoid revealing suppressed cells by subtraction. Monthly bars remain chronological. |
| Shared contracts | Added SMS package export, per-user idempotency replay ownership checks and updated OpenAPI. Regenerated tracked API declarations because package consumers require the new contract. |

The API declaration file is the intentional generated-source exception. APKs, caches, logs, registrants, real environment files and local artifacts are excluded from the commits.

## Conflicts and compatibility decisions

- Prisma was merged field by field: CareBill and payment metadata were added without removing any current research or clinical model. The resulting schema contains 103 models and validates.
- Existing Premium Web/Mobile implementations were retained; new destinations and panels were wired into them.
- New payment intents require a server-issued `bill_id`. Legacy clients that supply their own amount/currency/purpose must migrate to the bill workflow; those requests are rejected.
- Real provider refunds and cancellation of an uncertain external charge are not implemented. The UI exposes refund controls only when the backend explicitly permits a simulated refund.
- Legacy research query URLs intentionally deny direct operational-data aggregation. Current project authorization and governed release/download workflows are required.
- The original delivered handoff documents describe candidate provenance and historical tests. They are not evidence of current database or provider acceptance; this report records the current verification.

## Database review and approval boundary

- 25 migration directories are present: original 22, the two already committed research migrations, and new `20261023190000_verified_payment_bills`.
- All existing migration SQL files remain unchanged by this integration.
- The new billing migration adds a table, metadata columns, constraints and indexes. It does not reset, drop, truncate or reclassify historical payments as verified live transactions.
- New foreign-key update actions were aligned with Prisma's `onUpdate: Cascade` semantics.
- `prisma validate` passed with a nonconnecting placeholder URL. Normal Prisma client generation passed using the already installed engine; no database connection or schema deployment was required.
- No migrations, database-backed test bodies, seeds, schema creation or database resets were executed.
- Port 5432 was not queried or changed.

Proposed next acceptance environment, requiring owner approval before creation: a separate local PostgreSQL staging instance on an available non-5432 port such as 55439, disposable `ahealth_test` database, owned test schemas and unique OMOP/vocabulary schemas. Run all 25 migrations, verify server/database/schema identity before writes, then execute backend database suites and synthetic OTP/bill/USSD/research workflows with console/mock transports. Retain the staging data and backups until cleanup is separately approved.

## Verification

| Check | Result |
| --- | --- |
| Backend TypeScript builds | PASS — all 25 services via `pnpm --filter './services/*' build`. |
| Source/security regressions | PASS — 621/621 Node tests across verification suites, using actual source with injected transports/database doubles. |
| Executive disclosure policy | PASS — 3/3 service policy tests, plus authorization/banding regression coverage in the source suite. |
| Research pure / legacy boundary | PASS — 11/11 tests. |
| Web production builds | PASS — Staff Web, Admin, Doctor Admin and Analytics, from isolated source copies with the locked dependency versions. |
| OpenAPI | PASS — parse/bundle and declaration generation. Existing completeness warnings about response documentation remain. |
| Prisma | PASS — schema validation and client generation. Database migration execution remains NOT RUN. |
| Flutter non-live tests | PASS — 136/136. Live acceptance test files were excluded to avoid real service writes. |
| Flutter analyzer | PARTIAL — zero errors and warnings; 56 informational lint/deprecation findings. Default analyzer exits nonzero for these infos. |
| Android debug APK | PASS — `flutter build apk --debug`. |
| Android release APK | PASS — `flutter build apk --release`. Compilation does not establish signing, gateway configuration or device acceptance. |
| Exact integration content Gitleaks | PASS — Gitleaks 8.30.1 found zero leaks in the reviewed staged source. |
| Whitespace | PASS — `git diff --cached --check`. |
| Live readiness | BLOCKED — read-only probes could not reach backend ports 4001–4025 or Web login ports 3000–3003; no listener was found on 55432. No services were started/stopped for acceptance. |

Toolchain observed: Node 25.9.0, pnpm 10.34.4, Flutter 3.47.4 / Dart 3.13.3, Java 17.0.12, Prisma 6.19.3, OpenAPI TypeScript 7.13.0 and Gitleaks 8.30.1.

The first isolated Web build attempt caused the package manager to rewrite dependency links through a junction. The links were restored to all 66 locked direct dependencies, old links were retained in an offline temporary backup, and final Web builds used native Next CLI execution with independent dependency links. Temporary build copies and caches were retained. No dependency versions or lockfile entries were changed.

## Security and exclusions

- Full extracted candidate Gitleaks scan produced 39 generic-key findings in its historical `docs/research-portal/rc2/FILE_SHA256_MANIFEST.json`. The matched values were verified as source checksums. That historical manifest was not imported.
- The exact newly integrated source was independently scanned from Git index blobs and had zero findings. This is a secret scan, not certification of production research de-identification.
- No real `.env`, credentials, private keys, patient-data files, database dumps, APKs, logs, `node_modules`, `.local` or generated caches were staged.
- `Web/docs/The Boogeyman.md` was absent from the candidate and was neither imported, modified nor redistributed. Its existing local/Git copy remains preserved and uncleared.
- Synthetic source fixtures remain clearly test data. External SMS, wallet charges and live carrier workflows were not exercised.
- Historical root checksum/candidate metadata files, research evidence logs and old verification manifests were omitted from the integration. The original ZIP remains the recovery copy.

Exact omitted candidate metadata paths:

```text
AHP-ADMIN-ANALYTICS-SHA256SUMS.txt
HANDOFF-SHA256SUMS-20261023.txt
RELEASE-CANDIDATE-20261023.md
RESEARCH-PORTAL-CANDIDATE.json
RESEARCH-SHA256SUMS.txt
UNIFIED-SOURCE-SHA256SUMS.txt
docs/research-portal/evidence/browser-checks.json
docs/research-portal/evidence/installer-tests.json
docs/research-portal/evidence/research-plus-role-tests.tap
docs/research-portal/evidence/static-checks.json
docs/research-portal/evidence/typescript-syntax.json
docs/research-portal/rc2/FILE_SHA256_MANIFEST.json
docs/research-portal/rc2/VERIFICATION.json
```

## Remaining acceptance work

1. Obtain owner approval for the isolated staging database, then run migrations and database-backed backend tests, including actual locking/concurrency and migration consistency checks.
2. Configure approved provider sandbox credentials and test callback verification and OTP delivery without real money or live SMS.
3. Run authenticated browser and physical Android phone acceptance against staging; no emulator acceptance is claimed.
4. Configure an approved HTTPS gateway and release signing before distributing a release APK. The existing release startup guard rejects missing/local/insecure gateway configuration.
5. Resolve the informational Flutter lint backlog and remaining OpenAPI documentation warnings as a separate quality pass.
6. OTP-first complete onboarding, unified Get Care, complete physical/hybrid/online workflows, Family tier subscription billing and production research governance remain subject to the original handoff limitations. Combining delivered candidates does not complete those requirements.

No push, merge, production deployment, database change, real SMS, real payment or cleanup deletion was performed.

## Changed-file inventory

The following paths are the integration changes relative to `77f4158`, including the separate test-safety commit and this report.

- `apps/patient-mobile/lib/core/payment_bills.dart`
- `apps/patient-mobile/lib/screens/home_screen.dart`
- `apps/patient-mobile/lib/screens/insurance_payments_screen.dart`
- `apps/patient-mobile/lib/screens/payment_bills_screen.dart`
- `apps/patient-mobile/test/payment_bills_test.dart`
- `apps/staff-web/app/admin/dashboard/page.tsx`
- `apps/staff-web/app/admin/payments/page.tsx`
- `apps/staff-web/app/analytics/dashboard/page.tsx`
- `apps/staff-web/app/analytics/research/[query_id]/page.tsx`
- `apps/staff-web/app/analytics/research/page.tsx`
- `apps/staff-web/app/analytics/surveillance/page.tsx`
- `apps/staff-web/app/bff/[...path]/route.ts`
- `apps/staff-web/app/doctor/case/[consultation_id]/page.tsx`
- `apps/staff-web/components/admin/adminAnalytics.module.css`
- `apps/staff-web/components/admin/AdminPopulationPanel.tsx`
- `apps/staff-web/components/admin/types.ts`
- `apps/staff-web/components/BillIssuer.tsx`
- `apps/staff-web/components/BillsWorkspace.tsx`
- `apps/staff-web/lib/api.ts`
- `apps/staff-web/lib/premium/navigation.ts`
- `apps/staff-web/lib/roles.ts`
- `apps/staff-web/middleware.ts`
- `docs/ADMIN-EXECUTIVE-ANALYTICS-20261024.md`
- `docs/PROVIDER-INTEGRATION-RC-20261023.md`
- `docs/research-portal/ACCEPTANCE.md`
- `docs/research-portal/rc2/IMPLEMENTATION.md`
- `docs/research-portal/README.md`
- `docs/UNIFIED-INTEGRATION-HANDOFF-20261024.md`
- `docs/UNIFIED-INTEGRATION-RESULTS-20261024.md`
- `packages/api/openapi/a-health-api-v1.yaml`
- `packages/api/openapi/research-portal-v1.yaml`
- `packages/api/src/generated/schema.d.ts`
- `packages/database/omop/v5.4/catalog.json`
- `packages/database/omop/v5.4/schema.sql`
- `packages/database/prisma/migrations/20261023190000_verified_payment_bills/migration.sql`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/test-safety.ts`
- `packages/http/package.json`
- `packages/http/src/integrations/sms.ts`
- `packages/http/src/middleware/idempotency.ts`
- `packages/http/src/tokens.ts`
- `scripts/research-vocabulary-manifest.cjs`
- `services/auth/.env.example`
- `services/auth/src/config/env.ts`
- `services/auth/src/services/auth.service.ts`
- `services/gateway/.env.example`
- `services/gateway/src/config/env.ts`
- `services/gateway/src/routes/gateway.routes.ts`
- `services/gateway/src/services/internalAuth.ts`
- `services/gateway/src/services/ussd-flow.ts`
- `services/gateway/src/services/ussd-security.ts`
- `services/gateway/src/services/ussd.service.ts`
- `services/gateway/src/tests/gateway.test.ts`
- `services/gateway/src/types/gateway.types.ts`
- `services/notification/.env.example`
- `services/notification/src/config/env.ts`
- `services/notification/src/providers/index.ts`
- `services/notification/src/services/templates.ts`
- `services/payment/.env.example`
- `services/payment/src/adapters/provider.ts`
- `services/payment/src/config/env.ts`
- `services/payment/src/controllers/payment.controller.ts`
- `services/payment/src/index.ts`
- `services/payment/src/routes/payment.routes.ts`
- `services/payment/src/services/bill.service.ts`
- `services/payment/src/services/intent.service.ts`
- `services/payment/src/services/policy.ts`
- `services/payment/src/services/refund.service.ts`
- `services/payment/src/services/settlement.service.ts`
- `services/payment/src/services/webhook.service.ts`
- `services/payment/src/tests/payment.test.ts`
- `services/payment/src/types/payment.types.ts`
- `services/payment/src/workers/reconcile.worker.ts`
- `services/research/src/services/query.service.ts`
- `services/research/src/tests/research.test.ts`
- `services/surveillance/src/controllers/surveillance.controller.ts`
- `services/surveillance/src/routes/surveillance.routes.ts`
- `services/surveillance/src/services/admin-analytics.policy.ts`
- `services/surveillance/src/services/admin-analytics.service.ts`
- `services/surveillance/src/tests/admin-analytics.policy.test.ts`
- `verification/admin-analytics.test.cjs`
- `verification/followup-test-target-guard.test.cjs`
- `verification/provider-release/auth-gateway.test.cjs`
- `verification/provider-release/production-flows.test.cjs`
- `verification/provider-release/webhook-handler.test.cjs`
- `verification/research-portal/fixture.cjs`
- `verification/research-portal/legacy-and-bff.test.cjs`
- `verification/research-portal/load.cjs`
- `verification/research-portal/policy.test.cjs`
- `verification/research-portal/run.cjs`
- `verification/research-portal/scanner.test.cjs`
- `verification/research-portal/workflow.test.cjs`
- `verification/research-warehouse/domain.test.cjs`
- `verification/research-warehouse/fixture.cjs`
- `verification/research-warehouse/postgres-adapter.test.cjs`
- `verification/research-warehouse/run.cjs`
- `verification/research-warehouse/workflow.test.cjs`
- `verification/staff-role-routing.test.cjs`
