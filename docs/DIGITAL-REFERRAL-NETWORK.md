# Digital Referral Network

## Architecture and data model

Digital referrals are persisted by the existing Network service (port 4017), with no new service. The Staff Web BFF maps `/referrals` to that service; the patient Flutter API maps the same resource to port 4017. PostgreSQL stores `digital_referrals` and one `digital_referral_outcomes` row per completed referral. Each referral references one consultation, patient profile, source and destination facility, optional departments/clinician assignment, and the exact patient-consent record used to authorize the destination.

The referral stores a clinician-reviewed minimum necessary summary rather than copying the patient's longitudinal record. Its outcome records a supported outcome category, optional follow-up recommendation and optional patient instructions. It is not a signed clinical note and does not replace the consultation note workflow.

## Lifecycle

The enforced lifecycle is `draft → submitted → received → accepted → in_care → completed`, with `declined`, `cancelled` and `expired` terminal alternatives. Every transition is checked in the Network service under row locks and an optimistic version check. Concurrent accepts result in one winner. A duplicate active referral for the same consultation, source clinician and destination facility is rejected.

These states mean different things: **submitted** means the source sent the referral; **received** means a verified clinician at the destination acknowledged it; **accepted** assigns the referral to that receiving clinician; **in_care** is recorded separately by that clinician when care starts; **completed** requires a persisted outcome. The app never tells a patient that submission alone means a facility accepted them.

Draft/submitted/received referrals expire at the earlier of 14 days or the exact consent expiry. Accepted and in-care referrals do not expire based only on that submission window. Explicit patient-consent revocation cancels active referrals transactionally, including accepted/in-care records; reads hide consent-dependent clinical summary after authorization is revoked.

## Authorization and cross-facility workflow

Creation and every receiving action require a current, active, verified clinician whose database profile belongs to an active facility and (when assigned) active department. Source clinicians must be assigned to or primary on the consultation. Destination actions are limited to clinicians at the addressed facility and optional department; after acceptance, only the accepting clinician can start or complete care. No facility-admin-to-facility mapping exists in the current User model, so this milestone does not grant a facility administrator referral access.

The Network service requires an active, non-break-glass `facility` consent with `current_thread` scope, matching the exact patient profile, the consultation's care thread and the destination facility. Phase A clinician collaboration consent does not satisfy this check. `GET /referrals/authorizations` exposes only active exact-thread facility grants, and only to a verified clinician already involved in that consultation. The patient may grant or revoke consent through the existing consent service. Revocation and cancellation are recorded; completed referrals remain recorded, while subsequent clinician access to the summary is removed.

The destination can read only the referral context while this consent is active. The API does not grant general access to patient profiles, prior consultations, medications, investigations, messaging or the longitudinal chart. Patient visibility is limited to their own authenticated profile (or its configured guardian); patients cannot change referral state.

## Staff Web and patient experience

The Doctor workspace is available at `/doctor/referrals`. It lists only cases assigned to or owned by the current primary clinician, presents only destinations with active exact-thread facility consent, and allows review/editing of the minimum necessary summary before submission. The receiving inbox uses separate receipt, accept, care-start and completion actions, and records outcome feedback for the source clinician.

The Flutter patient app provides **Rufaa Zangu** under “Afya yangu”. It reads only `GET /referrals`, shows source/destination, state and timestamps, and expands persisted outcome and patient instructions. It does not expose transition controls.

## API

- `GET /referrals` — current patient's non-draft referrals.
- `GET /referrals/cases` — cases the verified clinician is involved in.
- `GET /referrals/authorizations?consultation_id=…` — active facility grants for that exact case.
- `GET /referrals/source` and `GET /referrals/inbox` — source tracking and destination queue, including active referrals assigned to the accepting clinician.
- `POST /referrals` — create a draft; requires consultation, destination, consent ID, purpose and clinician-reviewed summary.
- `GET /referrals/{referral_id}` and `/summary` — role-, facility- and consent-checked read.
- `POST /referrals/{referral_id}/submit`, `/receive`, `/accept`, `/decline`, `/start-care`, `/complete` and `/cancel` — idempotency-key protected state transitions.

Request/response contracts are defined in `packages/api/openapi/a-health-api-v1.yaml`. The common BFF and Flutter service maps route `/referrals` to the existing Network service.

## Notifications and audit

Referral changes enqueue the existing generic `referral.update` template to known patient/guardian and clinician participants. SMS content contains no facility, diagnosis, summary, referral purpose or other clinical detail. In development, the Notification service defaults to its console provider; delivery is simulated and the log masks phone numbers and omits message bodies. No carrier delivery is claimed.

Audit Ledger actions include `referral.created`, `submitted`, `received`, `accepted`, `declined`, `care_started`, `completed`, `cancelled`, `expired` and `access_denied`. Event metadata is allowlisted to state changes, outcome category or a fixed reason; clinical summaries and outcome text are not copied into audit metadata. The global tamper-evident chain is checked by the ledger verification API.

## Verification

`services/network/src/tests/referral.test.ts` is a DB-backed test suite and refuses to run unless `DATABASE_URL` targets local `ahealth_test` on a non-5432 port. It covers lifecycle transitions, source/destination/patient isolation, unverified clinicians, duplicate creation, concurrent acceptance, decline, cancellation, expiry, consent revocation, outcome read-back, safe audit details and chain verification. Flutter widget coverage lives in `apps/patient-mobile/test/referrals_screen_test.dart`; the screen supports injected fixture data for widget tests, while production reads the authenticated patient API.

For real Firefox acceptance, use synthetic fixture accounts and an isolated `ahealth_test`, then set the existing Playwright `.env.local` values. Screenshots and test output belong in ignored Playwright evidence directories. Do not inject auth cookies.

### Patient B isolation acceptance — 2026-10-12

- The previously verified backend `GET /referrals` isolation evidence remains valid: Patient B's list excluded Patient A's referral and consultation IDs. Patient A's own read-back evidence is retained from the earlier acceptance.
- Two Patient B development OTP flows were previously requested and verified through Auth's normal local flow. At that historical read-only check, the count was two challenges in the rolling hour against the limit of five. Tokens existed only in temporary test processes and Flutter mock secure storage; none is reusable now, and no new OTP was requested during this final controlled acceptance.
- The earlier silent reports came from the evidence path being optional and unset, together with the runner wrapper discarding stdout/stderr. The test's failure catch can capture a `TestFailure`; a controlled synthetic widget assertion inside `tester.runAsync` verified this without authentication. It recorded test name, stage, exception type, sanitized source frames, synthetic expected/actual UI state, absent HTTP status and process exit code before termination. Runner stdout and stderr were captured separately. The expected probe exit code was 1. Probe evidence is under ignored `.local/acceptance-evidence/patient-b-diagnostic-probe-*` files.
- The separate synthetic UI defect remains fixed: API errors no longer display the authorized-empty state, previous rows are cleared during loading, states are mutually exclusive, retry is available, and malformed success envelopes are rejected. Nine focused referral tests pass: loading, authorized empty, error, retry, malformed response, direct non-owner denial, referral rendering/outcome, and synthetic A-to-B session/cache isolation. The full Flutter suite had previously passed 92 tests with five live tests skipped; it was not rerun because this acceptance changed only tests/diagnostics. Full live two-account switching remains unexercised.
- No new OTP was requested. The previously recorded count of two challenges against a five-per-hour limit is no longer treated as current. A fresh read-only count could not be obtained: the worktree has no local Auth/database `.env` file, and a no-password read-only connection to the isolated database was rejected. The running Auth service exposes no read-only rate-window endpoint. The OTP endpoint was not called, so Patient B live Flutter list, direct-ID, and session/cache acceptance remain pending until the legitimate rate window can be checked with approved local DB credentials or a current count.
- Earlier backend direct-ownership denial and list isolation, Patient A read-back, Firefox acceptance, and Audit Ledger verification remain retained from the prior acceptance. No conclusion is drawn from audit-event absence; it does not establish whether a direct-ID request was reached.

## Unsupported features and governance decisions

- Facility administrators cannot access referrals until staff-to-facility/department membership is modeled and verified server-side.
- Clinician assignment is optional at creation; when absent, any eligible verified clinician at the destination may receive and accept, after which one clinician owns the workflow.
- No referral-created appointment, pharmacy handoff, FHIR/HL7 interoperability, external carrier SMS, earnings, emergency dispatch or blockchain is implemented.
- Legal/privacy governance must confirm whether this exact facility/current-thread consent and this minimum summary are sufficient for each operating jurisdiction, referral purpose, retention period, guardian scenario and receiving-facility duty. Until that review, deployment for real patient data is not approved by this code change.
- Business policy must decide whether urgent/emergency priority should route to a separately governed emergency process; a referral is not a dispatch or emergency response.

### Patient B controlled acceptance update — 2026-10-12

- The required diagnostic evidence path was writable and gitignored. The synthetic capture probe passed and separately captured trace, stdout, stderr and expected exit code; it verified exception, HTTP-status and sanitized expected/actual-state capture without authentication.
- One legitimate Patient B OTP request was made through Auth. Auth returned HTTP 200 and a challenge, without RATE_LIMITED; its response contained no dev_code. Verification was not attempted, no OTP was read from logs, and no retry was made.
- Patient B authentication and the live Flutter referral-list/direct-ID steps therefore remain **NOT EXERCISED**. Do not interpret network failure as isolation. The service source only includes dev_code when the running development configuration enables OTP echo; the live response did not include one. This is a local acceptance delivery/configuration blocker; no production-code defect was established.
- The focused Flutter referral suite remains 9/9 PASS, including deterministic synthetic A-to-B session/cache isolation. Full live two-account switching remains NOT EXERCISED. Prior backend Patient B list isolation/direct-ownership denial, Patient A read-back, Firefox acceptance, Network/Auth/Patient suites and Audit Ledger evidence remain historical evidence and are not a substitute for this live Flutter acceptance.
- Sanitized one-request evidence is in ignored .local/acceptance-evidence/patient-b-live-20261012-214734-* files. No credentials, OTPs, tokens or patient clinical payloads are recorded.
## Patient B final acceptance and OTP delivery — 2026-10-12

This section supersedes the earlier pending Patient B live-acceptance status above.

### OTP delivery diagnosis

- Auth generates a six-digit OTP, stores only its bcrypt hash with a five-minute default expiry, and writes the code to Auth's process console in development. Auth does not call the Notification service for OTP delivery.
- The Notification service's SMS console provider is separate: it masks the destination and logs message length, not the body. It is not the OTP sink; no carrier or Notification delivery is claimed for this acceptance.
- The existing local acceptance configuration has NODE_ENV=development and OTP_ECHO_IN_RESPONSE=true. The earlier request to the default Auth listener returned no dev_code and did not create a corresponding recent challenge in the isolated ahealth_test database. That acceptance.env file is not automatically loaded by dotenv.config(); the service reads environment variables or its normal .env file. The earlier challenge could not be reused from ahealth_test; its latest Patient B challenge was expired and consumed.
- A dedicated Auth process was started from this worktree with the existing development-only echo setting and isolated ahealth_test DATABASE_URL on port 55437. Its stdout/stderr were sent to NUL so OTP values were not logged or saved. The first dedicated challenge returned a development code in memory and was verified through the normal Auth verify API, but its session was consumed by the first test-harness failure before any Referral API step. After correcting the test-only assertion, one additional challenge was requested and verified for the final live acceptance. Both requests were HTTP 200 and not rate-limited; no further requests were made. Codes and tokens remained in memory only. No production Auth response or security logic was changed. A dedicated Network process used the same isolated database and JWT configuration. The existing listeners on ports 4001/4017 and PostgreSQL 5432 were not used for this acceptance.

### Live Patient B result

- Authentication: PASS through one legitimate development OTP request and normal verification.
- My Referrals API: PASS, HTTP 200. The authorized response had zero rows; Patient A's referral and consultation were absent.
- Direct Patient A referral ID: PASS, HTTP 403 NOT_RESOURCE_OWNER. The endpoint returned the generic ownership denial; no referral summary or instructions were saved in evidence.
- Flutter UI/cache: PASS. The app displayed the authorized empty state with loading and error states absent. Synthetic Patient A destination/instruction content was absent after switching to Patient B.
- The first live-test run stopped in its synthetic pre-switch setup because an assertion required a destination label to appear exactly once, while the expanded UI renders it twice. The test-only assertion now accepts one or more matches; no production source was changed. The final live Flutter acceptance passed (one live test; diagnostic probe skipped), and the focused referral widget suite passed 9/9.
- Sanitized trace, stdout, stderr and exit code are stored in ignored .local/acceptance-evidence/patient-b-auth-delivery-final-20261012-224217-* files. Focused-test output is stored in ignored .local/acceptance-evidence/patient-b-focused-20261012-224317-stdout.txt.
- The Audit Ledger was reverified after this acceptance: VALID, 247 events.
- Previously verified Network 18/18, Auth 20/20, Patient 14/14, Firefox acceptance, Flutter 92-test suite and synthetic account/cache regression evidence remain green. No migrations or seeds were run.
### Auth OTP security hardening — 2026-10-13

- Auth now requires an explicit `NODE_ENV` of `development`, `test` or `production`; missing and unknown values fail startup with a sanitized configuration error.
- OTP response echo and plaintext console logging are separate opt-in settings. Either capability requires explicit `AUTH_LOCAL_OTP_MODE=true`, development/test mode, and a local `ahealth_dev` or `ahealth_test` database on an explicit non-5432 port. Production rejects these settings. The example local Auth configuration opts into response echo for development and keeps console logging disabled.
- OTP verification always checks the challenge hash. The static development verification shortcut has been removed. Auth demo seeds require explicit development/test mode and a local non-5432 AHP development/test database.
- Verification after this change: Auth build PASS; isolated security configuration tests 7/7 PASS. The DB-backed Auth suite was not rerun because this worktree has no Auth/Web local `.env` or process `DATABASE_URL`; the suite guard requires the verified local `ahealth_test` database on a non-5432 port. No database was contacted. Earlier Auth 20/20 remains historical evidence from before this hardening, not post-change acceptance.
- Referral lifecycle code was not changed by this security hardening. Existing Network, Patient B, Firefox, Flutter, and Audit Ledger evidence above remains the retained referral acceptance record.
- The optional shell environment bootstrap requires a caller-supplied `DATABASE_URL`; it no longer embeds a local database password fallback.

### Final Auth runtime verification - 2026-10-13

This follow-up supersedes the earlier statement that DB-backed Auth and live OTP verification were still blocked.

- A fresh, isolated PostgreSQL 17 cluster was created under ignored `.local/phase-b-auth-postgres`, bound only to `127.0.0.1:55438`. Separate `ahealth_test` and `ahealth_dev` databases received all 17 current migrations. Prisma validation, migration status and live-schema diff passed for both databases; no schema drift was detected. The existing cluster files and PostgreSQL service on port 5432 were not used.
- Credentials and process configuration remain only in ignored local files. Test runs explicitly used `NODE_ENV=test` and `ahealth_test`; runtime OTP used `NODE_ENV=development` and `ahealth_dev`. Runtime OTP response echo was enabled only for this local non-5432 acceptance process, while plaintext console OTP logging remained disabled.
- The complete Auth suite passed 29/29, including OTP verification and rejection, expiry/reuse, rolling-hour rate limits, session refresh/logout, JWT and fail-closed configuration coverage. The first run exposed a test-fixture mismatch: the anti-enumeration login endpoint correctly omitted the development code for an unregistered number. The test now obtains its challenge through the normal patient registration flow; focused rate-limit and logout regression cases were added. Auth production behavior was not changed.
- Network passed 18/18, including Patient A ownership, Patient B isolation/direct-ID service denial, clinician verification and referral lifecycle checks. Patient passed 14/14. Auth and Network builds passed.
- A read-only ledger verification after the run returned VALID for both isolated databases: 2 events in `ahealth_dev` and 152 in `ahealth_test`. The earlier separate 247-event acceptance ledger remains historical evidence, not a count for these fresh databases.
- Production configuration probes passed: missing/invalid `NODE_ENV`, missing/placeholder JWT secrets and production OTP echo/plaintext logging were rejected; explicit production configuration initialized with development capabilities off, and the verification-bypass setting remained false.
- A synthetic patient registered through the local Auth flow, verified the challenge through the normal OTP endpoint and received a session. The Auth-issued token read `/patient-profiles/me` successfully (HTTP 200), was accepted by Network `/referrals` (HTTP 200), and a malformed token was rejected by Patient with HTTP 401. OTP, token, phone number and patient identity values were not written to evidence or logs.
- Sanitized runtime results are in ignored `.local/phase-b-auth-postgres/runtime-acceptance.json`; local database files and diagnostic logs remain ignored. The earlier Patient B live referral/UI acceptance and Ledger VALID, 247-event evidence remain retained as documented above.
