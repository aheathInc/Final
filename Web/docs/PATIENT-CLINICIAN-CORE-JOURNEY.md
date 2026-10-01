# Patient–clinician core consultation journey

## Implemented flow

The patient app sends consultation requests through the existing durable `POST /consultations` API and requires the server response to contain both the persisted consultation ID and its existing care-thread ID before showing confirmation. A stable operation ID is reused on retry. The detail screen reads `GET /consultations/{id}/queue-status`, supports manual refresh and bounded polling, and stops polling for `completed` or `cancelled` consultations. Status labels use the service vocabulary (`pending`, `offered`, `matched`, `in_progress`, `escalated`, `completed`, `cancelled`).

The home screen separates active from recent/completed care. A completed detail reads the signed outcome from `GET /consultations/{id}/note`, prescriptions from `GET /patient-profiles/{id}/prescriptions`, and linked adherence rows from `GET /adherence-logs`. The existing care thread remains the conversation route; a closed or unverifiable thread is read-only. Follow-up cycle check-ins are read through `GET /follow-up-cycles/{id}/check-ins`; responses continue through the existing check-in screen/API.

Clinical profile updates include the server's `base_version`. A version conflict is made visible and requires an explicit reload before another save. Logout calls the existing auth endpoint and clears local credentials even if the request fails.

## Existing API contracts used

- `POST /consultations`; `GET /consultations`; `GET /consultations/{id}/queue-status`; `GET /consultations/{id}/note`
- `GET /care-threads/{id}`; `GET` and durable `POST /care-threads/{id}/messages`
- `GET /patient-profiles/{id}/prescriptions`; `GET /adherence-logs`
- Existing follow-up cycle/check-in reads and check-in submission routes
- Existing patient profile update contract with `base_version`

No new backend endpoint or database migration is introduced. The existing consultation service already supports an optional directed clinician ID; the OpenAPI contract and schema test now record that field.

## Offer expiry and re-routing

There is one auditable offer row per consultation/clinician pair. When an offer expires, SLA routing may reactivate that same row for a new bounded TTL, preserving its response timestamp and incrementing its version; a declined offer remains terminal for that clinician. Routing, acceptance, decline, and offer lapse serialize on a consultation-scoped transaction lock. Acceptance and decline both recheck that the offer is still unexpired while holding the lock. The SLA worker uses a version/deadline compare-and-swap so concurrent ticks cannot escalate the same consultation twice. A consultation is marked `offered` only when at least one unexpired offer exists; otherwise routing returns it to `pending` (or leaves it `escalated`) for the normal SLA retry.

## Tests and acceptance status

### Verified in the isolated local journey

- Patient development OTP login resolves to the existing patient account.
- Profile updates send `base_version`; the stale-version response and reload
  behavior are covered by patient-care tests.
- Consultation creation persists the returned consultation and care-thread IDs;
  patient status reads remain openable through completion.
- Normal routing presents the same consultation as an actionable Doctor queue
  offer. The clinician accepted it through Staff Web.
- The existing patient message and one clinician reply were visible in the same
  care thread, and the patient read the reply back.
- The clinician completed that consultation with a synthetic non-clinical note;
  a fresh patient OTP session read back the completed consultation and signed
  note.
- Clinician access to Doctor routes and denial of Admin and Analytics routes
  were verified through Firefox Staff Web.
- Patient Flutter tests passed (16/16); offer-lifecycle and consultation
  engine/contract tests passed; consultation build and database-backed tests
  passed against the isolated test database.

The offer expiry recovery is implemented and regression tested: expiry hides an
offer from the queue, normal routing can reactivate the same auditable pair,
and concurrency/idempotency tests cover routing and acceptance races.

Not exercised: prescription creation, follow-up creation, and platform-admin
Staff Web access. The isolated journey database had no existing synthetic
platform-admin account. These do not change the verified patient-clinician
journey results.

Mobile visual runtime acceptance remains separate. Flutter unit/widget tests
passed, but no full mobile visual E2E was performed. The local app packaging
currently references a missing `assets/first_aid/` directory, which prevents
the executable mobile visual flow from starting.

Run patient tests from `Mobile app/patient_app`:

```powershell
flutter test --no-pub
```

The focused patient-care tests cover profile version payload construction, persisted consultation identifiers, status mapping/history partition, queue and note routes, prescription reads, durable thread-message request shape, and signed-note display.

Run the pure consultation contract/engine checks and type-check the affected service from `Web/`:

```powershell
corepack pnpm --filter @a-health/consultation exec node --import tsx --test --test-force-exit src/tests/engine.test.ts
corepack pnpm --filter @a-health/consultation build
```

The consultation engine/contract suite passed (15 tests), and the consultation
build passed. The offer-lifecycle and prescription-read suites passed against
the isolated `ahealth_test` database (13 tests total). Their mutating fixtures
must receive an explicitly verified `ahealth_test` URL before running:

```powershell
corepack pnpm --filter @a-health/consultation exec node --import tsx --test --test-force-exit src/tests/offer-lifecycle.test.ts src/tests/prescriptions.test.ts
```

The follow-up suite uses its own mutating fixtures and must also receive an
explicitly verified `ahealth_test` URL before running.

Run follow-up backend tests only with `DATABASE_URL` explicitly targeting the isolated `ahealth_test` database, following `LOCAL-WINDOWS-SETUP.md`:

```powershell
pnpm --filter @a-health/followup test
```

The verified patient-clinician core journey used the same consultation across
patient authentication, Doctor queue, Staff Web acceptance/completion, and
patient read-back. It does not establish prescription or follow-up creation,
platform-admin access, or full mobile visual acceptance. Do not use port 5432
or production data.

## Known limitations

- A requested clinician name is retained in the local confirmation flow. Backend assignment remains authoritative; the name is not represented as a guaranteed assignment until the queue-status response supplies an assigned clinician.
- Offline queued consultation writes are explicitly pending server confirmation and do not open the persisted detail until IDs arrive.
- Polling is limited to 30 attempts at 20-second intervals; the patient can refresh manually afterward.
- Prescription adherence is displayed only when existing adherence rows carry the matching prescription ID.
- Authentication refresh under natural token expiry and clinician follow-up
  read-back remain to be exercised.
