# Candidate verification

## Prerequisite: isolated review copy, not production

This directory contains offline source tests and a **separate real-DB gate**.
Neither runs automatically. Never use PostgreSQL 5432, an acceptance database
with retained data, or a shared/production database for the DB gate.

## Source-level tests (no database, no network)

From `Final/`, after dependencies have been installed by your approved local
setup from the committed lockfile, set `AHP_SOURCE_ROOT` to the full path of
`Final/`. Then:

```powershell
$env:AHP_SOURCE_ROOT = (Get-Location).Path
node --test --test-reporter=tap verification/consultation-thread-ownership.test.cjs verification/followup-no-inferred-recovery.test.cjs verification/followup-write-integrity.test.cjs verification/staff-role-routing.test.cjs verification/followup-test-target-guard.test.cjs verification/test-target-guard.test.cjs verification/runner.test.cjs
```

The source tests transpile the ACTUAL supplied service files and use explicit
in-memory collaborators. The three guard/runner files test verification tooling,
not product endpoints. No deployed-service or clinical validation is claimed.

The existing pure Auth security suite is also runnable with the repository's
locked tsx loader: `services/auth/src/tests/security-config.test.ts`.
It requires no database. The evidence included here ran this unmodified suite
through a temporary ESM transcription using TypeScript 5.8.3; it did NOT run a
full Auth login suite or a repository build.

## Real database gate (NOT RUN here)

```powershell
node verification/verify-safety.cjs --root . --check
```

`--check` requires exact candidate source fingerprints and workspace-local
pinned TypeScript/tsx/Prisma packages. It never installs dependencies or touches
a DB. In this environment it returned BLOCKED, exit 2, for missing packages.

Only after you have an explicitly approved, fresh isolated `ahealth_test` DB,
all committed migrations applied, generated Prisma Client, and the required
configuration set securely in your local environment:

```powershell
node verification/verify-safety.cjs --root . --run
```

The gate requires `NODE_ENV=test`, `AHP_SAFETY_TEST_DB_ACK` equal to
`ISOLATED_DISPOSABLE_AHEALTH_TEST`, a private `DATABASE_URL` for an explicit local
non-5432 port, and a test JWT secret. The runtime probe checks database identity
and ownership and that relevant business tables are initially empty.

The runner does not install, migrate, start/stop servers, reset a DB, or delete
an audit ledger. Suites mutate synthetic test data only after the guard passes.
The final consultation suite retains records, so a repeat full run requires a
fresh disposable target, not a destructive script reset.

Skipped, zero, cancelled, failed or timed-out suites do not count as PASS.
DB test results do not substitute for real HTTP/JWT, Staff Web or Flutter E2E.

## Cumulative changes and fingerprints

Requirements are updated for Candidate 005; prior Candidate 004 requirements are preserved as evidence. Do not reapply changesets 001/002
onto these already-corrected files. The historical pack ZIPs remain unchanged.
The compatibility copy of the old scheduler tests now understands the new
Prisma conditional-update methods; its original 22 behavioural assertions
remain. New tests cover response/closure races and required audit membership in
the transaction. Six real DB regression cases were added to the Follow-up
suite; these remain NOT RUN until this gate executes with actual dependencies.

## Archive hashes

Run the standard SHA-256 verification tool of your OS against `SHA256SUMS.txt`
from the directory containing `Final/`. The ZIP's own checksum is in its
external `.sha256` sidecar. Neither hash verification nor static scans certify
security, privacy, or successful runtime behaviour.

## Candidate 005 — Digital Front Desk

The prior safety gate above does NOT execute the new front-desk database suite.
Use a separate fresh disposable target for that suite; see
`docs/DIGITAL-FRONT-DESK.md` for its explicit safety prerequisites and commands.

New source-level regression (no real DB/browser):

```powershell
$env:AHP_SOURCE_ROOT = (Get-Location).Path
node --test verification/frontdesk-domain.test.cjs verification/frontdesk-service.test.cjs verification/frontdesk-routing.test.cjs
```

The 67 domain/service cases execute actual source using Prisma/transaction/audit doubles.
The 7 BFF cases execute actual URL resolution. Do not call either group end-to-end.
The database suite, Flutter tests, generated schema/client builds and real-login browser
smoke were authored but NOT RUN in this handover environment.

## Candidate 006 — Care Continuity update

`care-continuity.test.cjs` adds 78 source-function tests with explicit in-memory Prisma/provider/audit doubles; the complete `verification/*.test.cjs` suite now has 308 tests. These doubles serialize transactions and do not prove real DB concurrency.

The updated `requirements.json` checks Candidate 006 source, unchanged lockfile and 22 migration sources. `verify-safety.cjs --run` now also checks Notification and its DB dispatch suite, and requires explicit `SMS_PROVIDER=console` alongside the previous isolated-test acknowledgement. It never runs migrations. In this environment `--check` reported BLOCKED for missing pinned local TypeScript/tsx/Prisma, not source mismatch, and no DB connection was attempted.

Nine new Follow-up DB cases, three Notification DB cases and twelve Flutter cases are supplied but NOT RUN here. See `docs/CARE-CONTINUITY.md` for setup and exact acceptance boundaries. Browser evidence describes the standalone actual-component synthetic preview only, not a real Next/Auth/API deployment.
