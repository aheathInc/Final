# Final AHP Production-Readiness Acceptance

**Acceptance date:** 2026-10-06
**Repository baseline:** `aheathInc/Final`, `main` at `4a25d94a2075659986784e5fa3cca5106e30504e`
**Readiness worktree:** branch `release/final-production-readiness`, based exactly on the baseline SHA
**Decision scope:** production release *candidate* review. No production environment was accessed and no deployment occurred. This document records local acceptance evidence; the repository checkpoint is handled separately from release deployment.

## Decision

**AHP PRODUCTION RELEASE CANDIDATE — ACCEPTED**

This accepts the reviewed source candidate and isolated acceptance evidence. It does not mean AHP is deployed or that production secrets, provider accounts, domains, infrastructure, signing keys, monitoring, or operational ownership have been supplied. The production runbook lists those prerequisites. No production database migration was performed.

## Release inventory

| Component | Classification | Evidence / boundary |
|---|---|---|
| Flutter Patient app | Production required | Tests and Android release packaging passed. Release API URL is configurable and validated; no Android device E2E was run. |
| Unified Staff Web (`Web/apps/web`) | Production required | Type-check, production build, local production start, real Firefox role acceptance, and representative BFF routes passed. |
| Auth, patient, doctor, appointment, consultation, messaging, follow-up, emergency, pharmacy, diagnostics, quality, research, surveillance, facilities | Production required for enabled workflows | Built; representative local services ran against isolated `ahealth_dev`; all backend service suites passed. |
| PostgreSQL / Prisma | Production required | Fourteen migrations validated on isolated empty, upgrade, and restore databases. No production data was used. |
| Gateway, notification, AI, payment, families, education, network, insurance, sync, devices, prevention | Supporting / feature-dependent | Built and tested. Not all were started in the live acceptance stack; their production provider status is listed below. |
| Docker Compose | Development only | Compose configuration validated with process-only placeholder variables. It is not a production deployment definition and has no unified Staff Web service. |

The running local acceptance stack used 14 backend services on loopback and the isolated PostgreSQL cluster at port `55438`; all 14 service `/health` endpoints returned HTTP 200. Staff Web `/login` returned HTTP 200. Those processes and the isolated cluster were stopped after verification. Windows PostgreSQL port `5432` was not used.

## Dependency, Prisma, migration, and build evidence

- `pnpm install --frozen-lockfile`: PASS; lockfile unchanged.
- `flutter pub get --enforce-lockfile`: PASS; pub lockfile unchanged.
- `prisma validate`: PASS.
- `prisma generate`: PASS after stopping acceptance processes. An earlier attempt encountered a Windows engine-DLL file lock while services were running; the clean retry passed.
- `prisma migrate status`: PASS; all 14 migrations applied on isolated `ahealth_test`.
- `prisma migrate diff` against isolated `ahealth_test`: PASS; no schema difference detected.
- Empty database rehearsal: PASS; all 14 migrations applied from zero.
- Pre-ledger upgrade rehearsal: PASS; 13 pre-ledger migrations plus the ledger hardening migration. Synthetic v1 audit rows, hashes, links, and `hash_version=1` values were preserved; full chain verification remained `VALID`; update, delete, and truncate attempts were blocked by the migration's immutability controls.
- Backup/restore rehearsal: PASS; a custom-format backup of an isolated pre-ledger copy was restored to a separate isolated database; the snapshot and v1 chain matched before applying the remaining migration, and the post-migration chain was `VALID`.
- This is isolated migration evidence only; it is not a production migration claim.
- Final root workspace build: PASS, 30/30 build tasks across 37 packages, including all backend packages and all four Next apps. OpenAPI generation emitted existing path ambiguity and missing-4XX-response warnings; builds completed successfully.
- Staff Web `type-check`: PASS; production build: PASS; production server `/login`: HTTP 200.

## Backend test matrix

All suites below ran against verified isolated `ahealth_test`. Final configured reruns had zero failures and zero skips. Auth was rerun with the intended local development OTP configuration; payment was rerun with a process-only synthetic webhook key after an initial configuration-dependent failure. No provider credential was used.

| Service | Tests | Pass | Fail | Skip | Build |
|---|---:|---:|---:|---:|---|
| AI | 18 | 18 | 0 | 0 | PASS |
| Appointment | 11 | 11 | 0 | 0 | PASS |
| Auth | 20 | 20 | 0 | 0 | PASS |
| Consultation | 28 | 28 | 0 | 0 | PASS |
| Devices | 6 | 6 | 0 | 0 | PASS |
| Diagnostics | 17 | 17 | 0 | 0 | PASS |
| Doctor | 12 | 12 | 0 | 0 | PASS |
| Education | 8 | 8 | 0 | 0 | PASS |
| Emergency | 19 | 19 | 0 | 0 | PASS |
| Facilities | 5 | 5 | 0 | 0 | PASS |
| Families | 9 | 9 | 0 | 0 | PASS |
| Follow-up | 20 | 20 | 0 | 0 | PASS |
| Gateway | 9 | 9 | 0 | 0 | PASS |
| Insurance | 5 | 5 | 0 | 0 | PASS |
| Messaging | 6 | 6 | 0 | 0 | PASS |
| Network | 8 | 8 | 0 | 0 | PASS |
| Notification | 9 | 9 | 0 | 0 | PASS |
| Patient | 14 | 14 | 0 | 0 | PASS |
| Payment | 17 | 17 | 0 | 0 | PASS |
| Pharmacy | 13 | 13 | 0 | 0 | PASS |
| Prevention | 9 | 9 | 0 | 0 | PASS |
| Quality | 11 | 11 | 0 | 0 | PASS |
| Research | 6 | 6 | 0 | 0 | PASS |
| Surveillance | 6 | 6 | 0 | 0 | PASS |
| Sync | 8 | 8 | 0 | 0 | PASS |
| **Total** | **294** | **294** | **0** | **0** | **PASS** |

The shared database package smoke check also passed. A focused regression suite for production error-log redaction passed 2/2.

## Patient, staff, and role acceptance

- Real Firefox Staff Web suite: **2/2 PASS**. Clinician login, Doctor workspace, representative BFF reads, Admin/Analytics denial, mobile-width layout, and UI logout passed. Platform Admin access to Admin and Analytics pages, Doctor denial, and logout passed.
- The same Firefox suite also exercised the Admin audit-ledger page and its BFF verify action (`HTTP 200`, `VALID`); unauthenticated and clinician access to that page were denied.
- Patient development OTP authentication and clinician Staff Web credential login passed in the isolated local environment. The patient flow used development-only OTP behavior; SMS delivery was not simulated as a production delivery.
- Existing synthetic offered consultation was used; no additional consultation was created. Patient token was accepted by Consultation; clinician found and accepted the existing Doctor queue offer through the API, both roles exchanged same-thread messages, clinician completed it with an explicitly synthetic non-clinical note, and the patient read back completed state and signed note. This was an API journey, not a Flutter-device journey or a Staff Web click-through of the Accept action.
- Consent was granted and revoked on isolated synthetic data. Patient audit projection showed both events; a different patient's audit history and clinician access were denied; Admin ledger showed the events and verified `VALID`.
- Appointment, diagnostic, medication/adherence, emergency, quality, insurance, payment, and provider behavior passed their service regression suites. Staff Firefox verified representative appointment, investigation-order, adherence, pharmacy, emergency, clinician-verification, facilities, surveillance, and research BFF calls. Full Patient-app UI E2E for each of those domains was not exercised.
- Emergency service and Admin visibility were tested locally; no dispatch provider was contacted. Financial tests used local/provider test behavior; no money moved.

## Patient app and offline acceptance

- `flutter test --no-pub`: **86 passed, 0 failed, 4 skipped**. Skips require live integration configuration.
- `flutter analyze --no-pub`: **0 errors, 2 warnings, 29 info findings**. The two warnings are existing `unnecessary_cast` notices in untouched `privacy_consent_screen.dart`; the 29 infos are style notices. No new warning was found in the release-phase Flutter files.
- Android release packaging: **PASS**, unsigned test APK, 52.2 MB, built with a reserved invalid HTTPS endpoint only to test packaging/config validation. No production URL or signing key was supplied.
- New release URL checks reject blank, localhost, emulator-local, insecure, and nonstandard release endpoints; HTTPS production endpoints remain configurable. Debug local URLs remain available only in debug builds.
- Offline cache/outbox/idempotency, SMS privacy, USSD isolation, and online-required emergency behavior have automated test evidence. Android emulator/device E2E remains **NOT EXERCISED**; the available adb device was offline.
- No first-aid medical content was added or claimed.

## Authorization and security review

- JWT signing secret is required and validated to a minimum of 32 characters. Issuer and audience have shared public defaults in schemas; set both explicitly and identically for production. Gateway internal shared secret is required. OTP echo is forbidden in production.
- Staff Web uses HttpOnly, SameSite=Lax cookies and sets Secure when `NEXTAUTH_URL` is HTTPS. Access tokens stay server-side. Login/logout and role restrictions were verified with real Firefox sessions. Natural token-expiry refresh remains implemented but was not exercised by this acceptance.
- API services use bearer-token guards and server-side role/ownership checks. Representative Patient ownership, consent, consultation, clinician, Admin, Analytics, and audit-ledger boundaries passed automated and live checks. This is not a claim that every endpoint has had an independent penetration test.
- Shared HTTP services use Helmet, a 1 MB JSON request limit, structured access logs without request bodies, and a logger redaction list for passwords, OTPs, tokens, cookies, and clinical text. Production unexpected-error logging previously included full exception messages/stacks; that proven leak was fixed in this worktree to log only error type and request ID, with 2/2 regression tests. Development retains local diagnostics.
- Auth attempt/OTP limits and AI message limits exist. Global API rate limiting was not demonstrated. Express CORS currently uses the package default permissive origin policy without credentials; configure an explicit origin policy at the public API edge before exposing browser-facing APIs.
- Failure/recovery checks: an isolated service with an unavailable database returned `/health` HTTP 503 and `database=down`; an HTTP SMS provider pointed only to an unused loopback port returned retryable `NETWORK`. Backup/restore and ledger verification passed. No shared/production service was deliberately stopped.
- Performance result: **PERFORMANCE SMOKE ONLY**. Fourteen local service health endpoints and Staff Web login responded; no load test or formal latency SLO measurement was performed.

## Secret/private-data scan

- Scanner covered 912 Git-tracked paths: 911 text files plus one oversized file scanned separately. It reported 76 pattern matches: 23 test/local fixtures, 52 database URLs in local templates/setup/docs, and one test credential candidate in `Web/setup-auth-tests.sh`. All 52 URLs were local/template/bootstrap examples; no external literal database credential candidate was found.
- The single test-credential candidate belongs to the test setup helper, not a runtime or production seed. Current seed scripts now require `AHP_SEED_ADMIN_PASSWORD` / `AHP_SEED_CLINICIAN_PASSWORD`, have no source default, and refuse production mode. The baseline Git commit still contains the prior synthetic development seed constants in its history; do not reuse them outside local synthetic tests. This worktree does not rewrite history.
- A separate scan of the 22.7 MB `Web/docs/The Boogeyman.md` found four AWS Access Key ID-shaped strings but no paired AWS secret-key field, private key, JWT, password assignment, or database URL. It also contains email/phone-shaped text from unrelated cybersecurity-article content; no AHP patient/financial record was identified. Static scans cannot prove absence of unlabelled free-text personal data.
- Ten `.bak2` source backups are already tracked in the baseline; they were scanned as text and are not introduced by this work. They remain repository hygiene debt. No exact tracked `.env`, `.env.local`, `.local`, database dump, SQLite data, private-key file, auth state, cookie, screenshot, `.next`, `node_modules`, or log path was found.
- Local runtime secrets, databases, test output, screenshots, Flutter APK, and Node/Next build artifacts were kept in ignored locations. Flutter generated registrants and generated API schema output were restored in this worktree after verification.

## Integration classification and remaining limits

| Integration | Classification | Current acceptance result |
|---|---|---|
| PostgreSQL / Prisma | Production configuration required | Isolated migrations, drift check, restore, and ledger verified; no production database. |
| SMS | Production configuration required; generic HTTP adapter exists | Console provider is refused in production. No provider URL/key was configured. |
| AI chat | Local stub by default; OpenAI-compatible adapter available | Stub tests pass; production refuses chat stub. No production model endpoint/key; not clinical AI. |
| AI transcription | Stub by default; HTTP option available | No live transcription provider configured. |
| USSD | Local engine only | No carrier integration. |
| Payments | Local console/mock only | Production refuses console mode; no functioning verified money-transfer integration or transfer test. |
| Insurance | Local/internal claims | No external insurer integration. |
| Emergency dispatch | Local workflow | No external dispatch/carrier integration. |
| Email | Not configured | No production email provider found. |
| File/object storage | Not configured | No production storage provider verified. |
| Telemetry/monitoring | Not configured | Structured application logs exist; no external monitoring platform verified. |

Known unsupported/partial behaviors remain: provider earnings/settlement, patient rescheduling, patient dispensing writes, patient incident reopen/status, patient claim submission, payment intent without an authoritative quote, AI patient-profile context/history restoration, consent enforcement across all services, real emergency dispatch, first-aid content, and production SMS/USSD carrier integrations. They are not represented as implemented.

## Container and operational result

- Docker Engine was available. Development Compose config failed when required local variables were absent and passed static parsing when dummy process-only placeholders were supplied. No Compose stack or PostgreSQL container was started.
- A standalone Unified Staff Web image build was attempted. Docker Desktop failed while downloading a Node base-image layer with `unexpected EOF`; the app build itself had already passed outside Docker. No container started and no image is treated as release evidence. Docker is not a required production model in this repository; there is no production Compose definition.
- Production endpoint values, provider credentials, external storage/telemetry configuration, Android signing material, and formal load/security testing remain release-operator prerequisites. No production deployment occurred.

## Worktree and preservation state

- Final phase changes are limited to the patient release URL guard/tests, seed credential environment handling/docs, Staff Web audit-ledger E2E coverage, production error-log redaction/tests, and this runbook/report.
- The original dirty checkout's seven pre-existing generated Flutter files were not touched. Windows PostgreSQL port `5432` remained untouched; only the isolated port `55438` cluster was stopped.
- Acceptance evidence was gathered on `release/final-production-readiness` from the stated baseline before the final repository checkpoint. The checkpoint does not change the acceptance evidence or imply a merge, tag, or deployment.
