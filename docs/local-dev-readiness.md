# A-Health local readiness report

Report date: 2026-10-21. The local stack is running against PostgreSQL 17 at `127.0.0.1:55432`, database `ahealth_dev`. PostgreSQL 5432 was not accessed. This report distinguishes health checks, automated service tests, and browser/mobile journeys; a healthy port alone is not treated as proof of a business workflow.

## Service inventory and current status

All 25 services are TypeScript/Express applications with an entry point at `services/<service>/src/index.ts`, a shared `/health` endpoint, and a Turborepo `dev` task. At the captured run, all 25 health endpoints returned HTTP 200 with `status: ok` and database health `ok`. The full isolated local backend run completed 26/26 Turbo test tasks successfully; the payment suite was also rerun after its test cleanup change (17/17 passed). Service test files are under each service's `src/tests/` directory.

## Activation validation summary

| Check | Result |
|---|---|
| Local stack status | 25/25 backend health endpoints and 4/4 web login routes passed on the latest status check. |
| Backend tests | `pnpm test:local`: 26/26 Turbo tasks passed; payment suite rerun: 17/17 passed. All owned test schemas remain in `ahealth_dev`. |
| Monorepo build | The last full `pnpm run build` completed 30/30 Turbo tasks. After the final Staff Web RBAC edit, `pnpm --filter a-health-web type-check` passed; the full build was not repeated while Next.js dev is using its build directory. |
| Staff Web browser tests | Acceptance 4/4 and authenticated front-desk checks 2/2 passed after the final route-policy change. |
| Flutter tests | Widget tests: 130 passed, 8 skipped. Physical Pixel 4 wireless integration test: passed. |
| Flutter static analysis | `flutter analyze --no-pub` exited 1 due to 44 info-level style/deprecation suggestions; no warnings or errors were reported. |
| Database safety | Migrations are up to date on the isolated PostgreSQL 17 `ahealth_dev` instance at port 55432. Port 5432 was not accessed; no database was reset or deleted. |

The first facility-admin browser check exposed an overly broad admin route rule; that authorization issue was corrected and the full four-role acceptance suite passed afterward. The Flutter analyzer suggestions and the unimplemented workflows noted below remain open; this report does not claim production readiness or a full end-to-end journey across all care stages.

| Service | Port | Domain and verified surface | Local result |
|---|---:|---|---|
| auth | 4001 | Password login, OTP, JWT issue/validation, refresh/logout, user identity, audit ledger | Healthy; suite passed; live password, OTP, JWT, logout, invalid-login and RBAC checks passed |
| patient | 4002 | Patient profile, dependants, consent | Healthy; suite passed; live authenticated profile read passed |
| doctor | 4003 | Clinician profile, verification, availability and slots | Healthy; suite passed; Staff Web clinician login passed |
| appointment | 4004 | Appointment and slot scheduling | Healthy; suite passed |
| consultation | 4005 | Triage, matching, queue, consultation records and offers | Healthy; suite passed; queue API reached through Staff Web |
| messaging | 4006 | Thread messages and realtime WebSocket delivery | Healthy; suite passed; Postgres-backed event bus is local infrastructure |
| followup | 4007 | Follow-up cycles, adherence and reminders | Healthy; suite passed; mobile widget coverage passed |
| notification | 4008 | Notification templates and delivery adapter | Healthy; suite passed; delivery is simulated locally |
| ai | 4009 | Patient assistant conversations and navigation actions | Healthy; suite passed; mobile live-navigation test exercises this API |
| emergency | 4010 | Emergency reports and transport dispatch state | Healthy; suite passed |
| pharmacy | 4011 | Medication search and dispensing handoff | Healthy; suite passed; Staff Web BFF medication lookup passed |
| payment | 4012 | Payment intents, refunds and provider callbacks | Healthy; 17/17 payment tests passed; callback path is simulated locally |
| diagnostics | 4013 | Investigation orders and results | Healthy; suite passed; Staff Web BFF order list passed |
| quality | 4014 | Feedback and incidents | Healthy; suite passed |
| families | 4015 | Family membership and assignments | Healthy; suite passed; mobile route and widget coverage passed |
| education | 4016 | Published health content | Healthy; suite passed; mobile widget acceptance coverage passed |
| network | 4017 | Digital referrals, provider collaboration and interop | Healthy; suite passed; service integration tests passed |
| insurance | 4018 | Eligibility and claims workflows | Healthy; suite passed; external payer is not connected |
| research | 4019 | Ethics-gated, de-identified data queries | Healthy; suite passed; admin BFF dataset read passed |
| surveillance | 4020 | Aggregated disease signals and trends | Healthy; suite passed; admin BFF read passed |
| gateway | 4021 | SMS/USSD ingress and authenticated API bridge | Healthy; suite passed; carrier delivery is not connected |
| sync | 4022 | Offline change feed and queued-write replay | Healthy; suite passed; mobile offline-sync widgets passed |
| devices | 4023 | Wearable and vehicle telemetry | Healthy; suite passed |
| prevention | 4024 | Risk scores, screening and vaccination workflows | Healthy; suite passed; mobile route and widget coverage passed |
| facilities | 4025 | Facility directory and operational status | Healthy; suite passed; admin BFF facility read passed |

The APIs are REST/OpenAPI. No GraphQL server or GraphQL client integration was found. All backend test suites use isolated, uniquely named schemas inside `ahealth_dev`; `pnpm test:local` retains those schemas and never resets the development database.

## Web and mobile

| Client | URL / target | Current result |
|---|---|---|
| Staff Web | <http://localhost:3000/login> | Login, clinician workspace, admin operations/analytics, BFF calls, role route isolation and logout covered by Playwright acceptance. A queue with no offered work is shown as an empty state. |
| Doctor Admin | <http://localhost:3100/login> | Login route returned HTTP 200. |
| Operations Admin | <http://localhost:3200/login> | Login route returned HTTP 200. |
| Analytics | <http://localhost:3300/login> | Login route returned HTTP 200. |
| Patient Mobile | Pixel 4, Android 13, connected through wireless ADB (`10.210.148.186:42009`); host API address `10.210.148.4` | 130 Flutter widget tests passed and 8 skipped. The live device integration test passed over Wi-Fi: OTP registration, authenticated AI navigation, and cross-patient isolation. |

Staff Web Playwright acceptance passed 4/4: clinician, platform admin, facility admin, and pharmacist login/workspace/role isolation/logout journeys. The tests exercise authenticated BFF reads, admin audit-ledger verification, responsive clinician layout, and the pharmacist's API-backed verified pharmacy membership. The separate authenticated front-desk suite also passed 2/2 for clinician and platform admin. The clinician queue is empty in this synthetic local dataset, so the UI's backend-backed empty state was verified. During role testing, facility admin initially reached the platform dashboard; the middleware route policy was narrowed to the role's authorized facilities, incidents, and settings areas, then the acceptance suite passed on rerun.

`flutter analyze --no-pub` exited nonzero with 44 info-level style/deprecation suggestions and no warnings or errors. These analyzer suggestions remain outstanding. The Android integration test was run on the attached physical phone, without an emulator.

The service-level integration suites verify business rules for appointments, consultation offer lifecycle, digital front desk, medication fulfillment, referrals, follow-up, payments and access controls. The available UI acceptance run is a set of vertical slices; it does not claim a single uninterrupted UI journey through every stage A–G. External handoffs remain blocked or simulated as listed below.

## Authentication and supported roles

`pnpm seed:local` creates marked synthetic users using the password held in ignored `.env`: platform admin, facility admin, doctor/clinician, lab technician, pharmacist and patient. Hospital administrator maps to the schema's `facility_admin`. A marked synthetic pharmacy and verified membership are provisioned for the local pharmacist; no inventory or patient records are created. Nurse is not a supported enum value in this version. Patient login uses the actual OTP request/verify APIs; development OTP echo is explicitly enabled only for local use. `lab_technician` can authenticate, but this version does not expose a Staff Web lab workspace and diagnostics result entry is limited to the ordering clinician/platform administrator; no clinical permission was broadened for the local test.

Live checks confirmed a platform-admin password login, a 900-second access-token TTL, `platform_admin` JWT claim, authenticated identity and audit access, rejection of an invalid password (401), rejection of a modified JWT (401), rejection of unauthenticated audit access (401), denial of patient audit access (403), successful local OTP and profile access, logout (204), and rejection of refresh after logout (401). Passwords, access tokens, refresh tokens and OTP values are kept out of logs and this report.

## Infrastructure and external integrations

| Integration | Local implementation | What real integration still needs |
|---|---|---|
| PostgreSQL | PostgreSQL 17 local cluster, loopback-only port 55432 | No external dependency for local development |
| SMS / OTP | OTP is verifiable through the local response; SMS adapter is `console` | Approved telecom/SMS aggregator credentials and sender configuration |
| Mobile money | `console` provider and HMAC-signed callback simulation; no charge is initiated | Provider merchant credentials, registered callbacks and sandbox/production approval for each network |
| AI / transcription | Rule-based or `stub` adapter; no external model request | Model endpoint, credentials, data handling approval and clinical evaluation |
| Insurance | Local/manual workflow | Payer agreements, eligibility/claims API specifications and credentials |
| Hospitals / laboratories / FHIR | Local interoperability workflows and records; no outside endpoint configured | Counterparty FHIR/API endpoints, authorization and conformance testing |
| Emergency dispatch | Local dispatch/transport state only | Dispatch partner integration and explicit operational agreements |
| Messaging / realtime | PostgreSQL-backed event bus plus WebSocket delivery | No Redis dependency detected; production scale-out needs a shared broker strategy |
| Object storage | No local S3/object-store dependency detected | Configure approved storage before external attachment workflows |

No real messages, payments, dispatches, diagnosis, or patient data were used in these checks. The local synthetic seed accounts are development fixtures only. `AHP_STAFF_DEMO_V1` contains code for synthetic clinical records; it was not run as part of this activation. Its payment example now creates only a pending intent and refuses to alter an existing settled demo payment.

## Repeatable local commands

See [Local Windows setup](LOCAL-WINDOWS-SETUP.md) for prerequisites, private configuration and physical-device wireless debugging instructions. The verified device command was:

```powershell
flutter test integration_test/patient_ai_navigation_live_test.dart -d 10.210.148.186:42009 --dart-define=API_HOST=10.210.148.4
```

```powershell
pnpm seed:local
pnpm dev:local
pnpm dev:local:status
pnpm test:local
pnpm run build
```

`pnpm dev:local:stop` stops only the recorded launcher tree. The database persists across restarts. The test runner uses fresh run-specific schemas and does not delete them.
