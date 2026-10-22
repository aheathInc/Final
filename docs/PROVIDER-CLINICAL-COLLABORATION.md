# Provider Clinical Collaboration

## Status and scope

This Phase A implementation adds case-scoped, provider-to-provider requests to the existing `network` service and the unified Doctor workspace at `/doctor/clinical-collaboration`. It does not create another service or add a clinician to the patient's care-thread messaging channel.

The share currently exposes one consultation summary (`consultation_summary`) and a separate durable discussion. It does not expose patient identity, longitudinal records, signed notes, prescriptions, or the existing patient/clinician message history. The full referral network, pharmacy handoff, FHIR exchange, and transfer of case ownership remain out of scope.

## Authorization and relationship policy

Every request, acceptance, case read, discussion read, and discussion write requires all of the following:

1. An authenticated account whose role is `clinician`, with a clinician profile belonging to that user.
2. A currently active user account and a currently verified clinician profile, checked against the database on each operation.
3. An active facility assignment. If a department is assigned, it must be active and belong to the clinician's assigned facility.
4. The requester is the assigned clinician on the consultation or the primary clinician on its care thread.
5. The invitee is a specifically named, active, verified clinician.
6. An active, non-break-glass `current_thread` consent for this exact patient, care thread, and invitee clinician. Facility-wide consent is not treated as consent to collaborate with a named provider.
7. The collaboration is accepted, unexpired, and still points to the exact consent row that was active when the request was created.

Facility and department membership are displayed and snapshotted as context. Neither relationship grants access by itself. The patient's existing consent flow supplies the consent record; the patient or guardian must grant it before the clinician can select the invitee. A revoked consent revokes its pending and accepted collaborations in the same transaction. If a consent expires, the collaboration becomes expired at its next access/list check and access is denied immediately.

The current schema previously had facilities and departments but no clinician-to-department assignment. Phase A adds nullable `ClinicianProfile.departmentId` and the platform-admin-only `PUT /clinicians/{clinician_id}/assignment` endpoint. The endpoint rejects inactive facilities/departments and a department belonging to a different facility. Existing clinicians with no department remain unassigned; no department is guessed from specialty.

### Relationship scenarios

| Scenario | Supported rule |
| --- | --- |
| Same facility, same department | Named invitee, current verification, case involvement, and exact patient consent are required. |
| Same facility, different departments | Same requirements; department records are shown as context and do not substitute for consent. |
| Different facilities | Same requirements; cross-facility sharing is possible only through the patient's consent to that named clinician. Facility affiliation alone is not a basis. |

The platform's current consent model is the only authorization basis used by this feature. Before enabling cross-facility sharing for a real deployment, the product/legal owner must confirm that patient consent in the selected jurisdiction is a sufficient basis and define any additional facility approval, emergency, guardian, or sensitive-data rules. Until that decision, no alternative basis is inferred.

## Lifecycle and permissions

Stored states are `requested`, `accepted`, `declined`, `revoked`, and `expired`. `accepted` is effective only while the exact consent and expiry checks continue to pass.

| Action | Requester | Named invitee | Patient/guardian |
| --- | --- | --- | --- |
| Create request | Yes, if involved in the consultation | No | No |
| Accept or decline | No | Yes, while pending and consent is active | No |
| Read limited case and discussion | Yes, while accepted and active | Yes, while accepted and active | Not through the provider discussion endpoints |
| Revoke/relinquish access | Yes | Yes | Through existing consent revocation; all linked requests are revoked atomically |

Concurrent requests for the same clinician pair and consultation use a transaction-scoped PostgreSQL advisory lock. Accept, decline, revoke, and consent-revoke transitions use conditional updates so only a legal state transition wins.

## Architecture and persistence

- The existing `network` service owns these endpoints. The existing `messaging` service remains unchanged because its thread is explicitly patient-facing and limited to the patient, guardian, primary clinician, and assigned clinicians.
- `ProviderClinicalCollaboration` links one consultation, one requester, one named invitee, one patient consent, an expiry, a permission scope, and facility/department assignment snapshots.
- `ProviderClinicalCollaborationMessage` stores durable provider-only discussion messages. They do not create rows in `Message`, notification recipients, or patient-facing threads.
- The database migration adds the collaboration enums/tables and nullable clinician department assignment. It is forward-only and does not rewrite clinical rows.
- Existing idempotency middleware protects collaboration create/transition/message POST endpoints.

### API routes

- `GET /network/collaborations/cases`
- `GET /network/collaborations/eligible-clinicians?consultation_id=...`
- `GET|POST /network/collaborations`
- `GET /network/collaborations/{collaboration_id}`
- `POST /network/collaborations/{collaboration_id}/accept`
- `POST /network/collaborations/{collaboration_id}/decline`
- `POST /network/collaborations/{collaboration_id}/revoke`
- `GET /network/collaborations/{collaboration_id}/case`
- `GET|POST /network/collaborations/{collaboration_id}/messages`
- `PUT /clinicians/{clinician_id}/assignment` (platform administrator only)

The corresponding OpenAPI operations and response/error schemas are in `packages/api/openapi/a-health-api-v1.yaml`.

## Audit Ledger

The shared hash-chained Audit Ledger records request, accept, decline, access grant, case access, discussion access, message recorded, revocation, and expiry events. Message bodies and the free-text clinical question are never copied into ledger metadata. Metadata is limited to the fixed scope and controlled transition reason. The admin ledger exposes these events under the `collaboration` category; it continues to return only allowlisted details and chain verification remains unchanged.

## Synthetic development acceptance

The integration fixture `scripts/seed-provider-collaboration-test.ts` creates synthetic Doctor A and Doctor B in the same facility/department, Doctor E at a separate unrelated facility, a synthetic patient, one active consultation, and consent naming only Doctor B. It refuses to run unless `DATABASE_URL` is local `ahealth_test` on a non-5432 port, refuses fixed-ID collisions, and requires `AHP_PROVIDER_COLLABORATION_TEST_PASSWORD`. It was run against the isolated `ahealth_test` database. Doctor C and D relationship scenarios are created independently by the database tests for cross-department and cross-facility coverage.

Copy the variable names from `/.env.example` and `apps/staff-web/.env.example` into gitignored local environment files. Never put a real password in either template. The fixture prints only synthetic clinician emails and the consultation ID.

## Tests and local commands

To reproduce in a local environment, first set process-level `DATABASE_URL` from gitignored local configuration. Apply migrations separately to isolated `ahealth_dev` and `ahealth_test`; select `ahealth_test` before seeding or running database tests. Keep both URLs on loopback and a non-5432 port.

```powershell
cd Web
pnpm --filter @a-health/database exec prisma validate --schema prisma/schema.prisma
pnpm --filter @a-health/database exec prisma migrate deploy --schema prisma/schema.prisma
pnpm run seed:provider-collaboration-test
pnpm --filter @a-health/network test
pnpm --filter @a-health/network build
pnpm --filter @a-health/doctor test
pnpm --filter @a-health/doctor build
pnpm --filter @a-health/patient test
pnpm --filter @a-health/patient build
pnpm --filter @a-health/auth test
pnpm --filter @a-health/auth build
pnpm --filter a-health-web type-check
pnpm --filter a-health-web build
pnpm --filter @a-health/api lint
pnpm --filter @a-health/api build
pnpm --filter a-health-web exec playwright test tests/e2e/provider-clinical-collaboration.spec.ts --project=firefox
```

The backend database test suites reject non-local databases, databases other than `ahealth_test`, and PostgreSQL port 5432. The Firefox test uses actual Doctor A, Doctor B, and unrelated Doctor E logins through the UI; it does not inject cookies. It checks that Doctor E cannot read the case or discussion, and that Doctor B loses access after revocation. It writes screenshots only under Playwright's configured `test-results` output directory, which is gitignored.

The automated network tests cover same-facility/same-department, same-facility/cross-department, and cross-facility cases; exact-consent recipient eligibility; current clinician verification; unrelated clinician isolation; patient consent revocation; decline; expiry; durable message read-back; separation from patient-facing messages; audit events and chain validity; and concurrent duplicate request, accept/revoke, and request/consent-revoke transitions. The Firefox acceptance test covers a real UI request, acceptance, summary read, provider discussion refresh/read-back, outsider denial, and revocation denial.

## Acceptance evidence and remaining decisions

Runtime acceptance was completed on 12 October 2026 in the isolated feature worktree. A private PostgreSQL 17 cluster was bound to `127.0.0.1:55432`, with fresh `ahealth_dev` and `ahealth_test` databases; Windows PostgreSQL 5432 was not contacted. All 16 repository migrations are applied to both databases, Prisma reports both schemas up to date, and schema-to-database diff reports no difference on either database.

The focused database suites passed against `ahealth_test`: Network 16/16, Doctor 13/13, Patient 14/14, and Auth 20/20. They cover same-facility/same-department, same-facility/cross-department, cross-facility access, named consent, unverified and unrelated-clinician denial, cross-patient isolation, request/accept/decline, discussion persistence, revocation/expiry, concurrent transitions, and audit-chain verification.

Real Firefox Staff Web acceptance passed: Doctor A requested access, Doctor B accepted, both opened the same limited case, Doctor B sent a provider-only reply, and both clinicians read it after reload. Doctor E received 403 for the case and discussion; Doctor A revoked access and Doctor B then received 403. Screenshots are in gitignored `test-results/provider-clinical-collabor-0cf2b-r-discussion-and-revocation-firefox/` (`provider-collaboration-active-case.png` and `provider-collaboration-message-readback.png`). A separate synthetic request/accept/case-read/message-read/revoke operation on `ahealth_dev` produced all seven expected collaboration ledger events; access was denied after revocation and the chain verified `VALID` (7 events checked).

Prisma validation, Network/Doctor/Patient/Auth builds, Staff Web type-check and production build all passed. OpenAPI type generation succeeded and Redocly semantic lint validated the document. Its 37 warnings concern path ambiguity and missing-4xx coverage outside the collaboration operations; no collaboration operation produced a lint warning. The first Firefox attempt exposed a test-locator false positive: the reply text matched the textarea before the POST completed. The test now requires a rendered discussion-list item and a cleared input, and the complete Firefox run passed without a product-code fix.

Remaining product/legal decisions are the jurisdictional sufficiency of explicit patient consent for cross-facility sharing; whether facility administrators must separately approve collaborators; department assignment governance; and the minimum additional data permitted for specialities requiring images or diagnostic attachments. This implementation fails closed on all undeclared access bases and currently shares only the consultation summary.
