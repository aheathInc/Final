# Digital Front Desk — implementation candidate 005

Date: 21 October 2026. Status: **IMPLEMENTED SOURCE / SCOPED TESTS PASSED / LIVE ACCEPTANCE PENDING**.
This is new functionality on top of cumulative Candidate 004, not another audit-only pack.
It is not a production release, and does not implement every item in the AHP product vision.

## What has been built

A patient can pre-register for a particular active hospital and department, select a currently
available verified clinician or the department pool, declare arrival, and read a persisted
AHP ticket and its current state. A platform administrator records genuine manual
administrative clearance. A verified clinician from that department records actual clinical
assessment, calls a ready patient, and starts the existing consultation/care-thread workflow.
Existing consultation completion also completes the linked visit in the same transaction.

Three new presentation surfaces:

- Patient Flutter Home → **Huduma hospitalini** → **Ziara mpya / Ziara zangu**.
- Staff Web **/admin/front-desk** → facility opt-in, directory aliases, administrative queue.
- Staff Web **/doctor/front-desk** → department intake, clinical review, call/start and care link.

The new backend lives inside the existing **Consultation service**, not a new microservice.
Staff BFF and Flutter route `/front-desk` to that service (default local service port 4005).
When an actual API gateway is configured, its routing must also map this prefix to Consultation.
No gateway configuration or production deployment has been performed in this task.

## Patient journey and state semantics

| State | Meaning | Who can advance it? |
|---|---|---|
| `preregistered` | Ticket persisted, arrival not yet declared | Owner/authorized guardian checks in; staff may prepare review |
| `awaiting_review` | Arrival declared, one or more required checks still incomplete | Platform admin administrative review; verified department clinician clinical review |
| `waiting` | Arrival + administrative review + required manual checks + explicit clinical clearance all present | Available verified department clinician calls patient |
| `called` | A specific clinician has called the patient; care has NOT yet started | The assigned clinician starts consultation |
| `in_consultation` | Existing care thread and assigned in-progress consultation created atomically | Existing authorized consultation completion |
| `completed` | Existing consultation completed; linked visit updated transactionally | No further queue actions |
| `cancelled` | A pre-care visit was cancelled; history retained | No further queue actions |

Cancellation is allowed before consultation starts, not during/completed clinical care.
A stale action version returns 409 and requires reload. Escalated clinical review leaves the
visit outside the routine waiting queue. There is no algorithmic decision that a patient is safe.

**Pre-registration is not payment confirmation, insurance coverage, hospital acceptance of a
real-world partnership, clinical triage, or permission to bypass hospital personnel.**
Arrival is patient-declared; no GPS or physical attendance verification is claimed.

## Facility policy and clinician directory

Every existing facility is disabled for the new queue by default. No records are auto-enrolled.
Only an active platform administrator can enable it. Facility payment-review and insurance-review
requirements default to true; a verified facility policy must explicitly set them for future visits.
Each visit snapshots these flags. Policy changes do not silently waive checks on existing visits.
Human clinical assessment is always required.

The administrator uses existing facility/department records and can set directory aliases.
For example, configuring a real department with `meno`, `jino`, `tooth` makes those terms
eligible for **directory matching**. These labels do not assert a diagnosis, severity or specialty.
The patient must choose the suggested department; multiple matches do not silently auto-route.
No external language model receives the entered text. It is POSTed, not placed in a query URL.
Only the deliberately submitted visit purpose is persisted as clinical intake.

The provider board uses active verified clinician profiles and the actual facility/department
membership. It shows availability expiry, current AHP matched/in-progress consultation counts,
requested-clinician waiting counts, and department-pool waiting separately. AHP cannot account for
walk-ins or other hospital systems that have not been integrated. `estimated_wait_minutes` is
always null. The UI never invents an ETA.

The displayed FIFO position is within one administrative scope:
`facility + department + requested clinician OR shared department pool`.
It does not override clinical prioritization or promise next service. Calling a patient is an
explicit clinical staff action. Maximum 100 clinician rows are returned per department board;
this is not a capacity-reservation system for all existing online offers.

## Administrative review is manual, not a payment integration

No registration fee amount is created. No mobile-money transaction, bank charge or insurer API
request is sent. Required checks can only be recorded as `manually_verified` with a non-sensitive
facility verification reference. `not_required` is accepted only when the visit's snapshotted
policy allows it. Neither state is an electronic provider acknowledgment.

Do not enter card numbers, financial account numbers, insurer member identifiers or clinical
notes in verification-reference fields. References are stored for accountable manual review but
excluded from ordinary visit JSON and audit metadata. A platform administrator receives an
administrative projection without the clinical purpose.

A dedicated receptionist/facility-admin permission model has NOT been invented. Until one is
properly modeled and reviewed, `facility_admin`, pharmacist and researcher roles cannot perform
these administrative writes. This limits production deployment, but prevents blanket privileges.

## Security, correctness and concurrency

- JWT middleware applies to all `/front-desk` routes. Service functions recheck active account,
  actual user role, verified clinician identity, facility and department membership.
- Patient/guardian ownership is required for registration, personal history, arrival and patient
  cancellation. A caller-supplied patient ID is never accepted just because it is present.
- Intake sharing is explicitly confirmed for the selected department. This is not a new universal
  health-record consent scope or a legal basis for broad data sharing.
- Creation uses a cryptographically generated UUID `request_key` and canonical SHA-256 input
  fingerprint, persisted in the same transaction as the visit. Same key/same payload returns the
  existing visit; different payload returns 409. No body tokens are stored.
- An advisory transaction lock serializes active-visit creation for a patient/facility. Partial
  unique indexes backstop one active visit per patient/facility and one called/in-care front-desk
  patient per clinician. These raw-SQL indexes must be preserved in migrations.
- Visit mutations lock the visit row and check `base_version`. Calling/starting also lock the
  clinician before rereading availability. Invalid state/version retries are rejected before
  acquiring that clinician lock, avoiding a reverse-order wait with existing completion.
- State checks in SQL enforce administrative/clinical prerequisites before `waiting` and require
  clinician, timestamps and consultation linkage for later states.
- The new write plus required audit event shares one Prisma transaction, with bounded transaction
  options. Failure rolls back the new write. In-memory rollback tests do NOT prove PostgreSQL
  lock scheduling or actual database rollback; a real database gate is provided separately.
- Start creates a patient-owned CareThread plus an assigned chat-capable ConsultationRequest;
  existing note/prescription/messaging access rules still apply. There is no extra routing offer.
- The modality `chat` is used for the existing communication-capable consultation representation;
  this is not a new video/voice service or proof of physical care delivery.
- Existing consultation completion has a new transactional visit/audit update. Ordinary remote
  consultations without a front-desk visit continue through their existing path.
- Audit events carry identifiers, status and version, not purpose text, manual reference contents,
  payment details or symptom input. Responses use `Cache-Control: no-store`.

## Frontend behavior

Mobile requests are online-only. Nothing in this feature is silently added to the existing
outbox. The frozen creation request key is reused while a transport outcome is uncertain.
Explicit 403/404/409/422 rejection permits correcting the input and starting a new request;
the active-visit constraint remains a server-side backstop. Successful registration followed
by a failed list refresh remains visibly successful, not misreported as an unconfirmed create.

New visit history is in-memory, not stored in SQLite. `Session.identityChanges` notifies this
screen synchronously when explicit login/logout begins; UI state and pending requests are
invalidated. An owner/generation check is repeated after asynchronous secure-storage reads.
Old account data cannot deliberately be accepted into the new screen state. Flutter runtime
verification of these authored controls is still pending.

Selected visit status is polled every 15 seconds, at most 20 timer ticks, only while the screen
is foreground/current and not busy. Terminal states or logout stop polling. Manual refresh
remains available. This is bounded polling, not WebSocket or background delivery. Lists show the
50 most recent visits; the selected newly created visit is held separately. Directory UI shows
up to 100 facilities. Server list endpoints support cursors; extended UI pagination remains a
follow-on, not a claim of complete hospital/network scale.

The Staff Web uses existing components and exact current source tokens; this is not a merge of
pending Premium UI or an owner-approved modern UI redesign. It is a functional staff interface.

## API contract

The canonical file `packages/api/openapi/a-health-api-v1.yaml` contains 16 operations under
15 paths and 21 new schemas. Existing JWT authentication is preserved. Front-desk creation uses
body `request_key`; versioned actions use `base_version` and return conflicts on stale retries.
This explicit exception to the older generic `Idempotency-Key` convention is documented.

**The generated OpenAPI TypeScript client was NOT regenerated here**: its locked generator was
unavailable. New Staff Web code uses its own explicit DTO module, not stale generated endpoint
types. Run the repository's generator and lint before integration/merge; do not call this a
complete semantic-contract or generated-client acceptance.

## Migration and build gate — NOT executed here

New forward migration: `20261021090000_digital_front_desk`. The previous 20 migrations are
byte-for-byte preserved. Candidate has 21 migration directories. The new migration adds one
visit table, three enums, facility flags, department aliases, indexes and readiness checks.
It does not backfill fabricated visits or alter existing consultations. Default disabled avoids
activating a new clinical workflow on upgrade.

Use a SEPARATE review checkout and a fresh operator-owned PostgreSQL test cluster. Never run
against Windows PostgreSQL 5432, production or a shared acceptance DB. Do not overwrite a running
project with this archive. Configure secrets privately, keeping Auth and other services on the
same explicitly intended test environment. No credentials are supplied in this candidate.

After locked dependencies are available, from ``:

```text
pnpm install --frozen-lockfile
pnpm --filter @a-health/database exec prisma validate
pnpm --filter @a-health/database exec prisma migrate deploy
pnpm --filter @a-health/database generate
pnpm --filter @a-health/api generate
pnpm --filter @a-health/api lint
pnpm --filter @a-health/consultation build
pnpm --filter a-health-web type-check
pnpm --filter a-health-web lint
pnpm --filter a-health-web build
```

The migration command is an operator-controlled step ONLY after database ownership/target and
backup requirements are reviewed. No script in this candidate runs it automatically.
Rollback should restore an approved isolated backup or use a separately reviewed forward fix;
do not drop clinical visit history once real data exists. No down migration is supplied.

### Actual PostgreSQL regression gate

Set `NODE_ENV=test`, a private test `JWT_SECRET`, and a private `DATABASE_URL` explicitly pointing
to a NEW loopback `ahealth_test` on a non-5432 port. Set the non-secret acknowledgment
`AHP_SAFETY_TEST_DB_ACK=ISOLATED_DISPOSABLE_AHEALTH_TEST`.
The suite additionally checks database name, server address/port, owner=current role, recovery
state, and no pre-existing users/visits before fixture writes.

```text
pnpm --filter @a-health/consultation exec node --import tsx --test --test-concurrency=1 src/tests/front-desk.database.test.ts
```

Twelve authored cases exercise real Prisma paths, constraints, concurrent requests, linking to
existing completion, and audit-chain verification. They have **NOT RUN** here. They create only
synthetic service-level actors, do not log in through Auth, and retain fixtures/audit for review.
No DB reset or audit deletion is performed. Use a fresh disposable DB for a repeat run.

### Flutter and browser gates

From `apps/patient-mobile/`, resolve committed dependencies via the approved locked toolchain,
then run `flutter test --no-pub test/front_desk_test.dart`, the full suite and `flutter analyze`.
Fifteen authored cases cover parsing, stable keys, online-only writes, states and account changes.
They are **NOT RUN** here. No physical device/emulator testing was performed.

`apps/staff-web/tests/e2e/front-desk.spec.ts` contains two opt-in real-login smoke cases.
Set `AHP_FRONT_DESK_E2E=1` and ignored `E2E_CLINICIAN_*` / `E2E_ADMIN_*` credentials against a
verified isolated runtime; then run the file through the existing Firefox project. The tests do
not seed, inject cookies or silently perform clinical writes. They are **NOT RUN** here and are
not a substitute for the mutation acceptance sequence below.

## Human acceptance sequence still required

1. Use a legitimate synthetic admin, clinician, patient A and unrelated patient B. Configure
   actual synthetic facility/department membership using existing approved fixture mechanisms.
2. Enable the facility through Admin front desk; record the actual synthetic manual-review
   requirements. Add department directory terms; do not invent a clinical specialty policy.
3. Patient A logs in normally, chooses facility/department, checks availability, pre-registers,
   sees their ticket and declares arrival. No fee should appear without a backend quote.
4. Admin records only genuine manual administrative checks. The clinician records a synthetic
   completed assessment, then calls/starts the same visit. No UI success from mocked responses.
5. Patient follows the existing consultation/chat link. Complete the existing clinician workflow
   with clearly synthetic content; patient sees the same visit completed and signed-note read-back.
6. Patient B and unrelated department clinician must fail read/action attempts. Test concurrent
   retries and unavailable doctor handling with actual database records and preserved audits.
7. Verify the new ledger events and chain. Do not treat source-test success as this result.

## Executed evidence in this delivery

- 67 pure-domain/real-service-function regressions with explicit in-memory Prisma/audit doubles:
  PASS. The transaction double serializes operations and simulates rollback; NOT database locking.
- 7 real BFF URL resolver tests: PASS. NOT HTTP/JWT/Next.js server acceptance.
- Prior Candidate 004 source/tool regression remains 156/156 PASS on this candidate.
- Combined executable offline suite: 230/230 PASS, no failures/skips.
- 513 TypeScript/TSX files parse without syntax errors using TypeScript 5.8.3.
- Pure `domain.ts` and Staff DTO strict type-check passes. NOT full generated-Prisma/React build.
- Canonical YAML parses; local references and 16 route/contract operation parity checked.
  NOT Redocly semantic lint. Dependency lockfiles unchanged.

PostgreSQL, Flutter/Dart, pnpm and repository dependencies are unavailable in this execution
environment; npm registry lookup failed DNS resolution. No database connection, migration,
service startup, browser run, package install, GitHub write or deployment occurred.

## Not included / not implied

No live mobile-money/bank payment provider; no insurer eligibility API; no fixed registration
fee; no AI diagnosis or validated symptom triage; no USSD front-desk flow; no online booking
of hospital lab resources; no guarantee of all walk-in counts; no reception staff membership
model; no patient calling/video; no automated queue expiry/no-show workflow; no new family
subscription engine; no new research portal. Existing unrelated functionality is retained.
Pre-consultation chat before a clinician starts this visit is not newly provided. Hospital
agreements, clinical protocols, privacy/governance and operational approval remain required.
