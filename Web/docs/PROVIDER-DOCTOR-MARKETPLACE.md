# Provider / Doctor Marketplace

This milestone extends the unified Staff Web Doctor workspace over the existing clinician and consultation services. It is a provider work-discovery flow, not a financial marketplace.

## Status

| Area | Status | Current contract / behavior |
|---|---|---|
| Provider identity and profile | WORKING | `GET /clinicians/me` resolves the authenticated clinician profile; the Doctor profile page shows identity, license, specialty, facility membership, supported languages, account state and current load. |
| Verification | WORKING | Read-only for clinicians. Approval/rejection remains in the existing Admin verification workflow and the backend verification route remains `platform_admin` only. |
| Facility and specialty | WORKING | Profile displays its stored facility relationship and specialty. Routing ranks specialty and facility location using existing matching rules; there is no self-service facility edit. |
| Availability | WORKING | Doctor sees backend state, can toggle only when verified, receives the persisted API result, and reloads from the same profile endpoint. Off-duty clinicians are excluded from ordinary routing; already-assigned work remains assigned. |
| Actionable offers | WORKING | The existing offered queue returns only unexpired `offered` rows and now includes their persisted offer expiry and state. The UI hides missing/expired offers and disables expired actions. |
| Accept and decline | WORKING | Existing idempotent consultation actions are used. Acceptance requires the caller's own active offer; decline records the supported reason and invokes normal routing reevaluation. |
| Active work history | WORKING | Uses the clinician-scoped `GET /queue?scope=mine` response. |
| Completed work history | WORKING | Uses clinician-scoped `GET /consultations?status=completed`; it links to the existing consultation workspace and displays no invented productivity metrics. |
| Earnings, settlement, payout, bidding or provider-rate marketplace | NOT IMPLEMENTED | Payment records are patient payments. There is no clinician beneficiary, earnings share, settlement or payout record, or bidding/rate contract. No provider financial screen or derived rates are added. |
| Appointment history | PARTIAL | Existing Doctor Appointments remains available; the new history page covers consultations only. |
| Eligibility acceptance with synthetic Doctor A/B fixtures | PARTIAL | Existing router filters standard opportunities by verified, active and available clinicians, then ranks specialty, language, facility location and load. Live Firefox coverage requires isolated `ahealth_test` credentials and synthetic consultation IDs. |
| Profile failure / unavailable facility detail | PARTIAL | The page shows a safe unavailable state if a backend read fails; it does not invent a facility name or profile data. |
| Mocked provider workflows | MOCKED | None added. Existing payment test fixtures are not exposed as doctor compensation. |

## Authorization boundaries

- `GET /clinicians/me` accepts no clinician ID from the browser and requires clinician role.
- Reading a specific clinician ID remains owner-or-`platform_admin` only.
- Availability changes require an authenticated verified clinician and update only the caller's `cpid`.
- Verification and facility membership remain Admin-controlled.
- Consultation acceptance/decline use the existing service state machine and idempotency handling; no status field is editable from this UI.
- Completed and active consultation lists are scoped by the authenticated clinician profile.

## Verification

The focused service regressions are `Web/services/doctor/src/tests/clinician.test.ts` and `Web/services/consultation/src/tests/offer-lifecycle.test.ts`. The Doctor suite passed 12 tests and the consultation suite passed 28 tests against the isolated local `ahealth_test` database on port 55555. Database-backed tests must run only with a `DATABASE_URL` whose database path is exactly `ahealth_test` and whose port is not 5432.

Firefox acceptance is `Web/apps/web/tests/e2e/provider-marketplace.spec.ts`. It passed in Firefox using the real login form and covers Doctor A/B plus Admin, profile visibility, persisted availability, unauthorized verification, isolated offer access, accept, decline/fallback, Admin approval, and completed work history. It requires `E2E_CLINICIAN_EMAIL`, `E2E_CLINICIAN_PASSWORD`, `E2E_CLINICIAN_B_EMAIL`, `E2E_CLINICIAN_B_PASSWORD`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, and synthetic `ahealth_test` IDs in `E2E_MARKETPLACE_ACCEPT_CONSULTATION_ID`, `E2E_MARKETPLACE_DECLINE_CONSULTATION_ID` and `E2E_MARKETPLACE_COMPLETED_CONSULTATION_ID`. Store credentials only in ignored `Web/apps/web/.env.local`; do not add private values or fixture records to source control.

The narrow fixture script is `pnpm seed:provider-marketplace-test` (or `pnpm seed:provider-marketplace-test:replay` for fresh replay IDs). It refuses to write unless the database is local `ahealth_test` on a non-5432 port and `AHP_PROVIDER_MARKETPLACE_TEST_CONFIRM=write-local-ahealth_test` is explicitly set. Supply `AHP_PROVIDER_MARKETPLACE_TEST_PASSWORD` only through ignored local environment configuration. The script creates synthetic Doctor A/B, Admin, facility, patient, offer, and completed-work fixtures; it is not a general-purpose seed.

The live browser scenario toggles availability and restores the original value, verifies profile and Admin boundaries, denies Doctor B access to Doctor A's profile/offer, accepts and declines the designated offers through Staff Web, then reads completed work history. No patient or demo seed outside `ahealth_test` is part of this verification.
