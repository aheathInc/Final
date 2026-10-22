# A-Health — Integrated Candidate 006 / Care Continuity

**New functionality source + interactive preview. Not a production release.**

This single `Final/` tree includes Candidate 005 Digital Front Desk, earlier safety fixes, and the new Care Continuity implementation. Original uploaded archives and pending UI/demo branches have not been overwritten or blindly merged.

## Open the product preview

`demo-previews/AHP_Care_Continuity_Preview_006.html`

Open it in a browser. It renders the actual new Doctor React components and styling using explicitly synthetic in-memory responses. Try medication schedules, check-in review, contact planning, dark/compact mode, owner switching and service errors. It does not authenticate, contact a database, send SMS or place calls. It resets when reloaded.

## New actual application entry points

- Doctor follow-up desk: `/doctor/follow-up`
- Prescriber medication schedules: `/doctor/follow-up/medication-times` — a follow-up cycle is not required.
- Patient Flutter Home: **Ufuatiliaji wangu** — dose reports, check-ins/contacts, in-app reminders and optional SMS preference.
- Backend: `/care-continuity/*` on the existing Follow-up service.
- Notification: bounded leased dispatcher with generic care-message templates and current-eligibility checks.

## Start here

- `docs/CARE-CONTINUITY.md`: workflows, authorization, setup, migration, exact verification and limits.
- `docs/CANDIDATE-006-IMPLEMENTATION.md`: concise delivery report.
- `docs/verification/006/`: executed scoped test evidence and synthetic-browser evidence.
- `CANDIDATE.json`: provenance and test classifications.
- `CHANGES-006.json`: changes relative to the uploaded Candidate 005.
- `verification/README.md`: source tests and scoped real-database integration runner.

## Review before integration

Extract separately; do not overwrite an active checkout or import production secrets. The tree contains 22 migration sources: the previous 21 are unchanged, one new additive migration is provided and has **not been applied here**. Dependency lockfiles are unchanged. Generate Prisma/OpenAPI types using the locked toolchain, then execute database, Next.js and Flutter checks before merge.

Executed here: 308 scoped source/tool tests passed; 16 Chromium checks passed for the actual new React components with synthetic responses. These are not full repository builds, real PostgreSQL, JWT/BFF or Flutter-device acceptance. Dart source/tests are supplied but not executed here. No actual SMS delivery or calling integration was performed.

## Later consolidated-workspace verification

The archive-time limits above describe the original candidate checks. The consolidated workspace was subsequently verified with 26 backend test tasks, a successful Staff Web production build (42 pages), 130 Flutter tests passing with 8 skipped, and 5 authenticated Playwright integration checks passing against the isolated local runtime. The API contract lint completed successfully with 37 warnings. No production integration or deployment was performed.

Read the implementation guide before running anything. Legacy `SOURCE-COMMIT.txt`, `AHP-HANDOVER.md` and older reports identify historical input, not a new verified Git main/release. No commit, push, migration or deployment was performed. `SHA256SUMS.txt` is the per-file archive manifest; the archive itself has a separate checksum sidecar.
