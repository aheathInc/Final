# Verification scope — Research Portal RC1

## Executed in this environment

- 112/112 new Research source/transport/boundary tests: actual domain/service TypeScript transpiled by the test loader, with a transaction-capable in-memory repository, synthetic users and a test-only scanner. Includes real TCP transport tests against a fake ClamAV server, legacy endpoint rejection and BFF origin/cache behavior using Next/session collaborators. These are **not PostgreSQL/JWT/Express end-to-end tests**.
- 18/18 existing Staff role-routing tests after changing the approved researcher landing page. Combined count: **130/130**.
- 30/30 Chromium UI checks: actual new React components plus existing StaffShell/DisplayPreferences, connected via a test bridge to the real domain service HTTP fixture with in-memory persistence. Checks cover search, empty/error states, approved query, export request, eCRF response, light/dark, compact density, admin review dialog, unchecked approval attestations, Escape, mobile navigation and reduced motion. No uncaught browser JavaScript errors.
- A browser policy blocked direct localhost navigation. The test loaded components locally and bridged requests through the test driver to the HTTP service. **Real browser cookies, live NextAuth/BFF forwarding, real hospital accounts and real PostgreSQL were not exercised.**
- Standalone strict TypeScript check of pure portal domain/config/scanner/export/service modules with installed global TypeScript and Node types passed. This is **not** the locked full repository type-check; route/Prisma/framework imports require installed workspace dependencies.
- XLSX fixture opened successfully with Python openpyxl. ZIP members passed CRC checks; five rows were read with the expected header/aggregate data. Output is a real OOXML workbook, not a renamed CSV.

- Offline installer tests: **12/12 PASS** on synthetic temporary checkouts, including both baseline variants, no-write dry-run, backups, idempotency, conflict and symlink rejection, and corrupted payload denial. Windows execution itself was not run.
- Source OpenAPI route parity: **29 operations / 28 paths**, local references resolved. This is not Redocly lint. Additive SQL/scalar field presence checked against 13 Prisma models; not database validation.

## Added but not executed here

- Opt-in Prisma/PostgreSQL tests: application persistence + audit, owner isolation, missing evidence denial, concurrent dataset uniqueness, transaction rollback, live account suspension.
- Full Prisma schema validation, migration application and migration drift checks.
- Full locked Research/Next build and type-check; OpenAPI generation and Redocly semantic lint.
- Actual ClamAV malware assessment, infrastructure TLS/at-rest encryption, penetration tests, complete accessibility audit and production performance/load tests.
- External ethical review verification, data-controller agreements, real hospital pulls and research review by a qualified disclosure expert.

## Observed fixes during verification

- Corrected native input/select label associations using `useId`, explicit labels and `aria-describedby` for hints.
- Reset loading state and generation protection when the selected study changes.
- Added a session-identity component key so researcher switches unmount previous client state.
- Fixed quality-mapping reporting to use the currently reviewed vocabulary mapping rather than stale ingestion metadata.
- Added a fail-closed cross-source pooling gate so per-hospital pseudonyms cannot inflate unique-person privacy thresholds.
- Deprecated legacy unchecked-ethics queries rather than leaving a second access path open.

## Evidence

Sanitized TAP/JSON evidence is under this documentation directory. UI screenshots supplied separately contain **synthetic data**. No patient or credential data was used. A clean pattern scan is not a semantic PHI or legal certification.

## Release gate

Apply only in an explicitly approved staging/test environment. The portal feature flag remains off by default. Do not upload real data or real identity/ethics documents until key management, scanning, authorization, migration, retention policy and all relevant legal/operational approvals are validated.
