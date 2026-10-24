# A-Health Research Portal RC2 — OMOP + eCRF analytics

## Delivered in the complete A-Health source archive

- **OMOP CDM 5.4**: a pinned 39-table schema and type-aware SQL materialization layer for a **separate** PostgreSQL research-warehouse database, with vocabulary/import tooling, structured source bundles, source provenance, governed mappings, ETL planning, identities and quality checks.
- **Warehouse lifecycle**: versioned source batches; independent build inspection/approval; worker lease/retry; immutable build manifests; explicit per-project row-level approval; output inspection, revocation and audit checks before exports.
- **eCRF analysis**: reviewed form-response snapshots, fixed numeric bins, distinct participant counting, whole-variable small-cell suppression, withdrawal and snapshot invalidation, response charts, and approval-gated CSV, XLSX, JSON and XML exports. Row-level extracts require a separately approved scope; do not describe them as anonymous.
- **Premium Staff Web**: separate *Warehouse* and *eCRF responses* workspaces, states for unavailable/disabled resources, data quality, independent reviews, download checksum verification and responsive styling. User-facing values come from APIs, not synthetic patient rows.
- **Additive Prisma migration**: `20261024120000_omop_warehouse_response_pipeline` for governance metadata; existing migrations remain intact. All 24 source migration folders are included.
- **Unit/smoke checks**: `services/research/src/tests/research-warehouse-pure.test.ts` includes catalog, eCRF privacy, and CSV/XLSX cases.

## Scope and important limitations

This is a **review / staging candidate**, **not** a certified, fully operational hospital research warehouse. The CDM schema covers all 39 standard tables, but mapping every proprietary hospital system and implementing a comprehensive OMOP CDM ETL for arbitrary clinical sources is not possible without real data dictionaries, license rights and clinical validation. Import requires properly structured governed CDM data, vocabularies and source mappings; it does **not** synthesize missing DOB, clinical periods or coded diagnoses from aggregates. No claim of OHDSI DataQualityDashboard certification is made; the built-in checks are a conservative baseline. Free text/images are not accepted as de-identified research inputs. Row-level pseudonymized data still carries reidentification risk.

The project requires ethics approvals, data-controller authorization, legal/privacy review, disclosure-risk evaluation and governed release review before real hospital data is processed. All real-data features default to disabled. No live database is touched by this archive.

## Safe staging activation sequence (operator-led; no automatic data migration)

1. Extract the full ZIP into a **new** review directory. Do not overwrite the running checkout.
2. Install from the pinned lockfile, run existing tests/builds, validate the Prisma schema and review both new research migrations.
3. Prepare an approved isolated staging database and independently provision an appropriately protected **separate** warehouse DB; never use operational `ahealth_dev` as the warehouse and never touch the unrelated PostgreSQL port 5432.
4. Review the `services/research/.env.example`; keep real database credentials and encryption/linkage keys outside source control.
5. Execute research governance migrations **only on an authorized staging instance**, seed **synthetic** records, verify source and project permissions, and use `warehouse status`/explicit `warehouse init` only after confirming warehouse identity and ownership.
6. Import only licensed vocabularies or explicitly flagged synthetic test fixtures. Enable warehouse and worker flags only after evidence/clinical review.
7. Perform authenticated end-to-end tests of independent ethics/data-controller approvals, build denial/acceptance, withdrawal/revocation, exports and auditing. Run OHDSI DQD and specialist clinical/terminology review before real data.

## Verification performed in this isolated environment

- TypeScript/TSX **syntax parse** for 21 research/portal/UI files: 0 parse errors.
- Six pure-domain Node tests: **6/6 pass** (CDM table count, bins, small-cell suppression, duplicate input protection, pseudonymized response keys, CSV/XLSX signatures).
- Archive full-source files validated and manifest generated during packaging.
- **Not executed here**: full pnpm install/locked Next.js build, Prisma migration against PostgreSQL, licensed vocabulary ingestion, warehouse SQL execution, database-backed authorization tests, real provider integration and browser/device acceptance. Those gates are required before deployment.
