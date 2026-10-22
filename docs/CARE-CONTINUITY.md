# Care Continuity — Candidate 006

**Implemented source with scoped executed verification. Not a production release or an assertion that all AHP requirements are finished.**

This vertical slice implements clinician-configured medication reminder schedules, patient-reported adherence, durable in-app reminder records, opt-in generic SMS queueing, a clinician follow-up review desk, and planned contact records. It extends the existing Follow-up and Notification services; no new service, provider account, medical decision engine or clinical subscription package is introduced.

## User workflows and entry points

### Doctor: medication reminders, without requiring a follow-up cycle

`/doctor/follow-up/medication-times` lists prescriptions signed by the current verified prescriber. The consultation must be completed and the note signed by that prescriber. The prescriber selects an explicit start date, IANA time zone and one time for each already-prescribed daily dose. Frequency, duration and dosage come from the signed prescription and are not changed by this form.

A fully dispensed prescription (`completed`) is not treated as completed treatment; a discontinued prescription is ineligible. The server does not derive times such as 08:00/20:00 from the frequency. Those times in the preview are synthetic choices, not prescribing advice. Missing/ambiguous DST wall-clock times are rejected rather than silently adjusted. Retiming after any reported dose requires clinical review through a replacement prescription, rather than discarding reported adherence.

The form can pause reminders or cancel the reminder plan. Neither action is a clinical instruction to stop treatment. Cancelled plans cannot be reopened. Legacy unreported slots are retained as superseded, not deleted. Legacy rows are not automatically converted to an approved timing plan.

### Doctor: follow-up desk

`/doctor/follow-up` lists only the current verified clinician's assigned cycles. The three summary cards count the **loaded page**, not the entire hospital. It has clinical-review, medication-timing and contact panels. Check-in review is explicit and versioned. A late patient reply invalidates an earlier review. The existing explicit closure endpoint remains the closure mechanism; a time window ending, no response or a completed call never automatically means `recovered`.

Contacts can be planned as phone or chat, then recorded as completed, no answer or cancelled. The purpose is patient-visible; the clinician's private outcome note is not. An available phone link opens the device dialer and does **not** place, record or verify a call. Chat links open the existing consultation care conversation; no new patient-message transport is claimed. Contact planning does not automatically create an appointment in the Appointments service or send a contact-time SMS.

### Patient app

Home → **Ufuatiliaji wangu**. The new Flutter screen shows Dawa, Follow-up and Vikumbusho, with authorized self/dependant selection under the existing ownership/guardian rule. Dose states explicitly distinguish upcoming, not confirmed, patient-reported taken, skipped and delayed. Lack of confirmation is not a skipped dose and is not a diagnosis.

Patients can confirm taken/skipped/delayed, read an in-app reminder, review a planned contact, and opt in/out of generic SMS reminders. Reading a reminder does not confirm taking medication. Clinical responses use the existing check-in screen. New writes are online-only; this screen does not silently queue schedule, preference or contact mutations offline. It performs bounded foreground polling; it does not add Android background scheduling, FCM/APNs or an OS alarm.

Owner/generation guards clear the screen and invalidate previous asynchronous responses on session changes. Protected responses use `Cache-Control: no-store`. Detailed Flutter execution is still a required acceptance gate: the Dart tests below were authored but not run here.

## Reminder scheduling and delivery

The existing Follow-up process runs `reminderTick` at an explicit bounded interval (default 30 seconds). It considers active explicit plans and due unanswered scheduled check-ins in a bounded catch-up window (default 120 minutes, batch 100). It creates a durable in-app `CareReminder`; it creates a privacy-minimized `NotificationLog` only when the patient preference enables SMS and an active authorized recipient exists.

A subject lock plus unique indexes prevents repeat reminder creation for the same dose/check-in. This is not a claim that every upstream scheduler creates exactly one check-in for each intended clinical slot. Old due events outside the catch-up window are not bulk-texted after a long outage; their adherence remains unconfirmed. Workers must actually be running for reminders to be created.

The Notification worker acquires a bounded lease using a database compare-and-set claim, rechecks eligibility immediately before provider submission, and finishes only its own claim. Paused/cancelled/superseded/answered/expired/read reminders and disabled SMS preferences suppress an unsubmitted care notification. Existing HTTP provider transport receives a stable notification-row idempotency key. A successful console send is explicitly **simulated**; HTTP acceptance is not proof of handset delivery.

**Delivery guarantee:** a process crash after provider acceptance but before database acknowledgement creates an at-least-once retry boundary. Exactly-once external delivery depends on the provider honoring the key. An already accepted external message cannot be recalled by later pausing a plan. No carrier delivery or contractual delivery SLA was tested.

## Authorization, concurrency and audit

- Explicit JWT routes reuse the existing token validator. Source-level tests exercise caller arguments, not real JWT issuance.
- A patient/guardian reads only permitted profiles and related reminders/doses. Ordinary patients cannot configure clinician schedules, review check-ins or record clinician contact outcomes.
- Schedule configuration requires the verified active prescriber and signed source consultation; cycle detail/review requires the assigned verified active follow-up clinician.
- Schedule changes and dose confirmations take the same transaction-scoped `care-plan:<item>` advisory lock. Base versions reject stale mutations. Already-final reports cannot be overwritten; equivalent retries return the existing result.
- Schedule creation, superseding previous slots, new slots and required audit append share a transaction. Review/contact mutations and their required audit append also share their transactions.
- Contact creation uses a durable request key bound to cycle and payload. Route idempotency protects the other authenticated POST operations.
- Audit metadata records minimal identifiers, counts and statuses, not medication names, patient response bodies, private contact notes, phone numbers or tokens.
- Repeated explicit skipped reports create an audit marker only. No staffed escalation queue, automatic clinician call or automated treatment recommendation is claimed.

The in-memory tests serialize transactions and emulate rollback. They do **not** prove PostgreSQL locks, constraints, rollback isolation or cross-process delivery behavior. Those require the authored database suites.

## Data changes

One new forward migration: `20261021130000_care_continuity`.

New tables: medication reminder plans, care reminder preferences, care reminders and care contacts. Existing adherence rows gain nullable explicit-plan/superseded references; check-ins gain a private review note; notification rows gain a dedupe key and bounded claim lease fields. Checks enforce known plan/contact states and exactly one reminder subject. The migration neither invents clinical timing for existing prescriptions nor deletes legacy history.

The candidate contains **22 migration source directories**. The first 21 are byte-identical to Candidate 005. The new migration was **not applied here**; the Prisma client was not generated. Review backup/restore and actual schema diff in an isolated review database before migration. Rolling back code while workers may have leases or while plan data exists requires a controlled stop and compatibility review, not dropping tables.

## API contract

JWT authentication; protected writes additionally use the existing `Idempotency-Key` middleware. State/configuration writes have a base version where appropriate.

| Method | Path | Purpose |
|---|---|---|
| GET | `/care-continuity/me` | Authorized patient profiles, doses, cycles, contacts, plans and reminders |
| POST | `/care-continuity/patients/{id}/preferences` | Versioned opt-in/out of SMS |
| POST | `/care-continuity/reminders/{id}/read` | Read acknowledgement, not dose confirmation |
| GET | `/care-continuity/prescriptions` | Verified prescriber's signed prescription timing worklist |
| GET | `/care-continuity/worklist` | Assigned clinician's follow-up worklist |
| GET | `/care-continuity/cycles/{id}` | Scoped detail and review information |
| POST | `/care-continuity/items/{id}/schedule` | Explicit reminder schedule |
| POST | `/care-continuity/plans/{id}/state` | Pause/resume/cancel reminders |
| POST | `/care-continuity/check-ins/{id}/review` | Versioned clinician review |
| POST | `/care-continuity/cycles/{id}/contacts` | Planned phone/chat contact |
| POST | `/care-continuity/contacts/{id}/outcome` | Clinician-recorded contact outcome |

Existing adherence confirmation now accepts optional `base_version`; final-report overwrite protection is enforced even for legacy clients. OpenAPI was edited and its local references and route parity checked. **Generated API types and semantic lint were not run**: regenerate before a real build. New clients use local response types, not fabricated generated declarations.

## How to inspect the product now

Open `demo-previews/AHP_Care_Continuity_Preview_006.html` in a browser. This offline preview bundles the **actual React workspace components and CSS**, with an explicitly synthetic in-memory transport. It supports schedule save/read-back, pause, check-in review, contact planning/outcome, appearance/density, an owner switch and an error state. Reload resets demo data; it does not log in to AHP or send anything.

For portability only, the preview uses locally available MIT-licensed React 16.0 UMD files and a preview-only Fragment fallback. The actual application's pinned React 18 dependencies and lockfile are unchanged. The preview is not a production build and must not be deployed as a clinical app.

## Locked-toolchain integration steps (not executed here)

Use a separate review checkout and an explicitly authorized disposable PostgreSQL instance. Never target port 5432, a shared database or real patient data. DB-mutating automated tests require the actual database `ahealth_test`, loopback, a non-5432 server port, matching identity and the required owner safeguards. A local Docker-forwarded port may fail server-port/loopback guards; do not weaken those guards merely to run a test.

Supply local secrets through ignored config/process environment. Explicit `NODE_ENV=test` for tests, a fresh JWT secret, `DATABASE_URL`, matching issuer/audience and `SMS_PROVIDER=console` are required. Never copy credentials from old archives. Repository Auth production safeguards remain unchanged.

After confirming the target independently, from ``:

```sh
pnpm install --frozen-lockfile
pnpm --filter @a-health/database exec prisma validate
pnpm --filter @a-health/database exec prisma migrate deploy
pnpm --filter @a-health/database run generate
pnpm --filter @a-health/api run generate
pnpm --filter @a-health/api run lint
pnpm --filter @a-health/followup build
pnpm --filter @a-health/notification build
pnpm --filter a-health-web type-check
pnpm --filter a-health-web lint
pnpm --filter a-health-web build
```

`migrate deploy` above performs writes: run it only after the isolated target is verified. This document is not authorization to migrate an active environment. No runner here provisions or resets a database.

From project root, the updated scoped runner first checks pinned workspace dependencies/source fingerprints:

```sh
node verification/verify-safety.cjs --root . --check
# Only after fresh disposable DB verification, environment setup and explicit acknowledgement:
node verification/verify-safety.cjs --root . --run
```

`--run` additionally requires `AHP_SAFETY_TEST_DB_ACK=ISOLATED_DISPOSABLE_AHEALTH_TEST`. It verifies an empty test business schema and all 22 applied migrations before running Consultation, Follow-up and Notification checks sequentially. It refuses skipped/empty suites as PASS, captures sanitized evidence, and verifies the ledger. It does not install, migrate, reset, seed, push or deploy. It is not a replacement for all Front Desk, HTTP, Web or Flutter acceptance.

For a developer-led isolated runtime, run the existing Auth, Patient, Consultation, Follow-up and Notification services plus Staff Web with their verified private configs. Follow-up exposes the new endpoints on its configured port (default 4007); Notification default is 4008. Staff BFF/Flutter route `/care-continuity` to Follow-up. `CARE_REMINDER_INTERVAL_SECONDS`, `CARE_REMINDER_WINDOW_MINUTES`, `CARE_REMINDER_BATCH` and `DISPATCH_LEASE_SECONDS` are bounded configurable values, not delivery guarantees.

For Patient app verification, from `apps/patient-mobile/` with its supported toolchain:

```sh
flutter pub get --enforce-lockfile
flutter test --no-pub
flutter analyze --no-pub
```

Test a legitimate patient/guardian session and prescriber/assigned-clinician sessions through real Auth. Never inject production cookies or bypass OTP limits. Check existing medication/cache/outbox compatibility with final-dose immutability, cancellation, overdue check-ins and late responses. Re-run API, web keyboard/motion and physical-device acceptance.

## Executed verification, 2026-10-21

| Scope | Result |
|---|---|
| New source-function/domain/worker tests using database/provider doubles | 78/78 PASS |
| Prior cumulative scoped source/tool tests | 230/230 PASS |
| Combined suite | 308 PASS, 0 FAIL, 0 SKIP |
| Actual workspace components in Chromium with synthetic preview transport | 16 checks PASS, 0 page errors |
| Viewports in that preview | 1440, 1024, 768, 390 px; no horizontal overflow |
| Reduced motion and keyboard tab behavior in preview | PASS |
| Global TypeScript 5.8.3 syntax parsing | 513 TS/TSX files, 0 syntax errors; not locked build |
| Pure `schedule.ts` strict TypeScript check | PASS with global compiler; not full service check |
| OpenAPI YAML/local references/11 route operations | PASS; 1,045 local references resolve |
| Prior 21 migrations and dependency lockfiles | Byte-preserved |
| Shell syntax | 70/70 PASS; scripts not executed |

Evidence is under `docs/verification/006/`. The browser ran authored HTML with `page.set_content`; network/file navigation was not used to connect to a backend. This is not authenticated Next.js E2E, not the premium UI archive, not a live database and not a telephone/SMS integration.

**Authored but not run:** nine new Follow-up database cases, three Notification database cases, and twelve Flutter cases. PostgreSQL, pnpm/repository dependencies, Prisma and Flutter/Dart are absent from this execution environment; registry DNS lookup failed. The scoped integration runner correctly reported BLOCKED before connecting to a DB.

## Remaining product boundaries

No real SMS delivery, push notifications, handset alarms, telecom calls, automated escalation staff workflow or hospital deployment. Contact records are currently scoped to the active follow-up presentation. Family subscriptions/payments, insurer/laboratory integration, clinical AI routing and research-platform expansion remain separate unfinished requirements. The existing Front Desk from Candidate 005 is preserved, not revalidated end-to-end by this pass. Pending Premium UI and Demo source archives are not bulk merged.

This candidate adds real implementation, but full runtime integration and clinical/governance review remain release gates.
