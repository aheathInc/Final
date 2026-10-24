# A-Health — Unified Integration Candidate (24 October 2026)

## Purpose and provenance

This is a **complete-source candidate** combining three independently delivered update lines into one `A-Health/` tree:

1. **Real-Service Integration RC1 (23 Oct)** — Auth/SMS, payment bills/provider verification, Flutter bills, Staff Web bills, USSD bridge, payment migration and tests.
2. **Research Portal RC2 (24 Oct)** — governed research portal, OMOP CDM v5.4 warehouse, eCRF response analytics/exports, research migrations and tests.
3. **Admin Executive Analytics (24 Oct)** — platform-admin population statistics for region, age, sex, coded diagnoses, consultation trends and facilities.

The **Admin Executive Analytics full-project archive** was used as the base because its tree contains the Research Portal RC2 tree plus Admin additions. The Real-Service RC1 changes were merged against the common filtered handoff baseline. Exactly two paths had concurrent edits:

- `packages/database/prisma/schema.prisma`: combined the RC1 `CareBill`/payment relations and metadata with the RC2 research models and relations. No model was discarded.
- `packages/api/openapi/a-health-api-v1.yaml`: combined payment/USSD contract changes with Research Portal `$ref` paths. YAML parsed after merge.

Other RC1 changed and added paths were overlaid where the Admin/Research line did not modify them. This archive is not an approved production deployment or a Git merge; it does not include `.git` history.

## Contents

- Patient Flutter application, Staff Web and other existing apps, 25 backend service directories, shared packages and documentation.
- 25 Prisma migration directories: original 22, one verified payment billing migration, two research migrations.
- Research OMOP v5.4 SQL/catalog and eCRF analytics/export code.
- Admin population statistics endpoint and UI.

Historical checksum/manifests from individual update lines may describe their **original candidates** rather than this merged tree. The authoritative checksum inventory for this archive is `UNIFIED-SOURCE-SHA256SUMS.txt`.

## Tests executed on this assembled tree

- Provider integration / role-routing / database target guard tests: **147/147 passed**.
- Research Portal / warehouse tests: **223/223 passed**.
- Care continuity / front desk / follow-up source tests: **226/226 passed**.
- Total **596/596** source-level Node tests passed with `AHP_SOURCE_ROOT` set to the assembled tree and globally installed TypeScript.
- TypeScript syntax parser: **461 TS/TSX source files**, 0 parse errors (not a full type-check).
- Main OpenAPI YAML parsed; payment and research paths present.
- Prisma schema has 103 unique model declarations including CareBill and ResearchOmopBuild. **Prisma CLI validation was not run**.
- ZIP contents will be independently re-read and checked against the included per-file manifest.

## Tests not executed / blockers

**NOT PRODUCTION READY.** This environment does not provide a configured PostgreSQL instance, repo-installed dependencies, Flutter SDK, running AHP services or live external provider accounts. Therefore full pnpm builds/typechecks, `prisma validate`, database migration deploy, PostgreSQL-backed tests, Flutter builds, UI browser/device acceptance, live USSD/SMS/mobile-money tests and OMOP production ETL acceptance are **not verified**. An independent Gitleaks scan was unavailable. A local high-risk-pattern scan flagged one intentional remote-URL fixture using a placeholder credential in a research test; no live key was identified by that scan. This does not certify absence of secrets or PHI.

## Safety and installation

1. **Do not extract over** `C:\Projects\A-Health` and do not use `Replace All`.
2. Extract to a separate staging directory; inspect Git diff against your authoritative checkout. Preserve current local changes and generated Flutter registrants.
3. Scan the entire tree with an established secret scanner and review unverified legacy documents before any distribution.
4. Verify the Prisma schema with pinned Prisma and inspect all three new migrations on a dedicated, backed-up staging database. Never reset the active database or touch unrelated port 5432.
5. Install locked dependencies, run `pnpm build`, backend tests, Staff Web E2E, Flutter analyze/test/build and role/security checks.
6. Confirm payment callback verification, OTP delivery, USSD gateway authentication and Research governance with synthetic test accounts. Do not use real patient records or real money for testing.
7. Commit to a review branch and merge only after staged acceptance and owner approval.

## Still outstanding beyond the combined updates

OTP-first complete patient onboarding with password/PIN/biometrics, unified Get Care end-to-end, all physical/hybrid/online workflows, Family Basic/Upper/Premium subscription billing and privileges, live carrier integrations, production research de-identification/OMOP ETL governance and full clinical acceptance require further implementation/verification. This archive combines the delivered update candidates; it does **not** claim to complete those product requirements.
