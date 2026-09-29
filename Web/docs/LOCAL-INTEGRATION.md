# AHP Local Integration Matrix

> **Historical evidence only:** This matrix records checks run in the AHP repository on 2026-09-12. It is not proof that the recovered Final unified app or current Final services pass those checks. The old `scripts/local/*` lifecycle scripts are not present in Final. Current launcher from `Web/` is `bash dev-web.sh web`; current browser verification is pending.

Last updated: 2026-09-12.

Local dev database: existing Docker PostgreSQL `ahealth-pg`, database `ahealth_dev`.
Isolated test database: `ahealth_test` on the same `ahealth-pg` container.
Local apps: doctor-admin `3100`, admin `3200`, analytics `3300`.

Private pre-write backup taken before dev DB mutations:
`~/ahp-local-backups/ahealth_dev_20260912_133957.dump`.

## Checkpoint

Completed:

- PASS: BFF/server auth refresh for doctor-admin, admin and analytics.
- PASS: Same-browser cookie isolation for all three apps.
- PASS: CBC evidence contradiction resolved against exact DB/schema and API.
- PASS: Core synthetic doctor workflow through API persistence/read-back.
- PASS: Admin management actions where fixtures exist.
- PASS: Analytics API reads for current synthetic data.
- PASS: Isolated `ahealth_test` migrated and auth tests run against it.
- PASS: Firefox browser automation installed and used for real login checks.
- PASS: Safe local lifecycle scripts fixed and verified.
- PASS: Production builds for doctor-admin, admin and analytics.
- PASS: Payment refund API verified against `ahealth_test`.

Remaining:

- MOCKED: external AI, SMS/notification delivery, payment providers and gateway-provider integrations stay local/mock.

## Auth Lifecycle

| Case | Apps | Status | Evidence |
| --- | --- | --- | --- |
| Valid session/access token | doctor-admin, admin, analytics | PASS | Firefox visited `/queue`, `/emergency`, `/surveillance` in one browser context; `/bff/users/me` returned roles `clinician`, `platform_admin`, `platform_admin`. |
| Expired access + valid refresh | doctor-admin, admin, analytics | PASS | Synthetic expired NextAuth cookies returned BFF `200`, emitted a rotated `Set-Cookie`, and the next BFF call with that replacement cookie returned `200`. |
| Invalid/revoked refresh | doctor-admin, admin, analytics | PASS | Expired cookie with invalid refresh returned `401` and English message `Your session has expired. Please sign in again.` |
| Concurrent refresh | doctor-admin | PASS | Two simultaneous `/bff/users/me` calls with the same expired doctor cookie both returned `200`, both set replacement cookies, role stayed `clinician`. |
| Three apps in one browser context | doctor-admin, admin, analytics | PASS | Firefox cookie jar held `a-health-admin.session-token`, `a-health-analytics.session-token`, `a-health-doctor.session-token`; no role confusion on BFF reads. |
| Password preservation | login forms | PASS | Doctor login no longer trims password before `signIn`; admin/analytics already preserved password value. |
| Real Firefox login forms | doctor-admin, admin, analytics | PASS | Playwright Firefox used real login forms with no injected cookies. Callback responses were `200` with protected callback URLs `/queue`, `/emergency`, `/surveillance`; refresh preserved roles `clinician`, `platform_admin`, `platform_admin` in one browser context. |

## CBC Evidence

| Check | Status | Evidence |
| --- | --- | --- |
| Running diagnostics service DB/schema | PASS | Diagnostics process cwd is `services/diagnostics`; service `.env` points to `ahealth_dev`; exact query used `ahealth_dev.public`. |
| Exact DB result | PASS | `ahealth_dev.public.investigation_orders` contains ID `34adf903-50e5-4ad6-bd91-9cedfb08b1f5`; code `Complete Blood Count (CBC)`, type `laboratory`, status `ordered`, linked thread/patient present. |
| Exact API result | PASS | `GET /investigation-orders/34adf903-50e5-4ad6-bd91-9cedfb08b1f5` on diagnostics returned the same ID/code/type/status. |
| Contradictory no-row query | RESOLVED | `ahealth_test.public` has zero rows for that ID; the earlier no-row result was from a different DB context, not evidence that the dev order was gone. |

## Doctor Workflows

| Workflow | Status | Evidence |
| --- | --- | --- |
| Consultation -> messaging -> patient record | PASS | Synthetic consultations created/offered/accepted; 3 completed synthetic consultations persisted. Synthetic messages count: 3; read-back by care thread succeeded during API run. |
| Diagnostic ordering/list/detail | PASS | 3 synthetic diagnostic orders persisted with `clinical_notes='Synthetic local integration order only'`; order detail read-back returned `ordered`. Admin attempt to create an order returned `403`. |
| Prescription creation -> persistence -> patient record | PASS | 3 prescriptions persisted with item `Synthetic ORS template`; API read-back by prescription ID and patient prescription list confirmed the created prescription. |
| Follow-up creation/read/check-ins | PASS | 3 follow-up cycles persisted from completed synthetic consultations; cycle read-back returned `active`; adherence rows generated from prescriptions. Doctor patient-specific adherence filter returned `403`, preserving role boundary. |
| Availability/slots -> authorized appointment workflow | PASS | Doctor availability set true; slot publish/read-back succeeded for slot `b7a09df7-16e0-45b7-9f55-8e281e401ab8`; appointment `01d89e80-b4ac-4d7e-a319-bf1fba0a2b1e` booked/read back as `booked`; early start returned `409`. |
| Consultation completion restrictions | PASS | Repeating `complete` on a completed synthetic consultation returned `409`. |
| Lab-result boundary | PASS | Doctor can order/read own orders; result filing remains diagnostics/lab workflow and was not bypassed from doctor-admin. |

## Admin Workflows

| Workflow | Status | Evidence |
| --- | --- | --- |
| Clinician verification | PASS | Pending clinician was approved; verified clinician count is now 2. |
| Device management | PASS | Admin vehicle sensor registration/revocation completed; DB aggregate shows 1 synthetic `SYN-%` device with status `revoked`. Patient-worn device attempt without patient profile returned `403`. |
| Emergency dispatch/status | PASS | Synthetic emergency `b75b84bc-3c1c-4f43-8c8a-8be451cb73cb` advanced `dispatched -> en_route -> arrived -> resolved`; read-back returned `resolved`. Direct `dispatched -> resolved` returned `409`. |
| Payment refund | PASS | Isolated payment service ran on port `5012` with `DATABASE_URL=...ahealth_test`; API created a synthetic cash intent (`201`, `succeeded`), refunded `2345` (`201`), DB read-back showed `partially_refunded` and `refunded_amount=2345`, excess refund returned `422 VALIDATION_FAILED`; fixture rows were cleaned. |

## Analytics

| Workflow | Status | Evidence |
| --- | --- | --- |
| Surveillance filters/aggregates | PASS | `/surveillance/conditions` and `/surveillance/trends` returned successfully under analytics/admin token during API run; Firefox rendered protected surveillance page. |
| Research datasets | PASS | `/research/datasets` returned successfully under analytics/admin token during API run. External research export/provider integrations remain mocked/local. |

## Service Accounting

| Service | Status | Notes |
| --- | --- | --- |
| auth | PASS | Login, refresh, invalid refresh, concurrent refresh and tests verified. |
| patient | PASS | Patient profile ownership used by consultation, appointment, prescription and follow-up workflows. |
| doctor | PASS | Availability, slots, clinician verification and clinician reads verified. |
| appointment | PASS | Book/read/early-start restriction verified. |
| consultation | PASS | Create/queue/accept/complete/prescription/follow-up state restrictions verified. |
| messaging | PASS | Persisted care-thread message and read-back verified. |
| followup | PASS | Cycle/adherence creation and role-boundary rejection verified. |
| diagnostics | PASS | Order create/detail and CBC exact-ID evidence verified. |
| admin-facing devices/emergency/facilities | PASS | Device and emergency actions verified; facility used as dispatch destination. |
| payment | PASS | Refund API and service tests verified against `ahealth_test`; provider remains local/mock. |
| insurance | IMPLEMENTED BUT UNVERIFIED | Service is routed but no end-to-end claim fixture was exercised. |
| notification | MOCKED | Local worker/templates present; real SMS/app push delivery not used. |
| sync | IMPLEMENTED BUT UNVERIFIED | Service is routed; offline sync batch not exercised in this pass. |
| gateway | MOCKED | Gateway routes exist with signatures; real USSD/SMS providers not used. |
| ai | MOCKED | Local AI service only; no external AI provider used. |
| research/surveillance | PASS | Analytics reads verified against current synthetic data. |

## Automated Verification

| Check | Status | Result |
| --- | --- | --- |
| `ahealth_test` migration | PASS | Prisma applied all 12 migrations to `ahealth_test`. |
| Auth tests on isolated DB | PASS | `DATABASE_URL=...ahealth_test pnpm --filter @a-health/auth test`: 15 pass, 0 fail. |
| Payment tests on isolated DB | PASS | `DATABASE_URL=...ahealth_test pnpm --filter @a-health/payment test`: 15 pass, 0 fail. Cleanup now removes failed-intent fixtures for synthetic users. |
| App type-checks | PASS | `pnpm --filter doctor-dashboard type-check`, `admin-console type-check`, `analytics-portal type-check` all passed after login/build fixes. |
| Auth build | PASS | `pnpm --filter @a-health/auth build` passed. |
| Browser automation | PASS | Firefox 155 installed under `.playwright-browsers`; real login forms verified for doctor/admin/analytics in one context, no cookie injection. |
| Production builds | PASS | Actual webpack diagnostic was build-time `next/font/google` fetch failure for IBM Plex fonts under restricted network. Replaced with local system font CSS variables and disabled webpack build worker for visible diagnostics. `pnpm --filter doctor-dashboard build`, `admin-console build`, `analytics-portal build` all passed. |

## Safe Local Lifecycle

Use these scripts from the repo root:

```bash
scripts/local/start.sh all
scripts/local/status.sh
scripts/local/stop.sh
```

Safety behavior:

- Reuses existing `ahealth-pg`; does not start the Compose PostgreSQL service.
- Uses gateway port `4021`, matching service env and Compose.
- Records AHP-owned tmux sessions, visible PIDs, or namespace-safe `port:<port>` listeners under `.dev-logs/pids`.
- Removes stale PID files and converts invisible-but-listening services to port-only records instead of reporting false stale failures.
- Refuses duplicate starts when a port is held by a non-AHP process.
- Stops only AHP-owned tmux sessions or processes whose cwd/cmdline identify them as AHP-owned.
- Leaves already-running listeners alone when the listener PID is not visible in the current process namespace.
- Does not use `fuser -k`, volume deletion, database reset, or destructive migrations.

Verification on 2026-09-12:

| Check | Status | Evidence |
| --- | --- | --- |
| PID/status mismatch | PASS | Root cause was mixed process visibility: the running AHP stack was listening on ports but several listener PIDs were not visible from the managed execution namespace, so old numeric PID files were stale even though services were alive. `status.sh` now reports these as `running` port-only records. |
| `stop -> status -> start -> status` | PASS | `stop.sh` preserved existing port-only listeners, stopped only AHP-owned tmux sessions, removed stale records, and `start.sh all` restarted missing services without duplicate launches. |
| Backend health | PASS | `/health` returned HTTP `200` for every service port `4001` through `4025`, including patient `4002`, notification `4008`, insurance `4018`, gateway `4021`, and sync `4022`. |
| App availability | PASS | Apps on `3100`, `3200`, and `3300` responded with protected-route redirects (`307`), matching authenticated-app routing expectations. |
| Container preservation | PASS | `docker ps` showed `ahealth-pg`, `dvwa-db-1`, and `dvwa-dvwa-1` still running; no Compose PostgreSQL was started and no DVWA container was stopped. |
| Sandbox detach behavior | BLOCKED | Detached processes and tmux sessions created from a finished managed command are reaped by the executor environment. For this acceptance-prep session, missing services were held in a live foreground supervisor while health was verified; running the same scripts from a normal local shell should keep tmux sessions alive. |
