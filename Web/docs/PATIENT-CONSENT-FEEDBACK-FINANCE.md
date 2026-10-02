# Patient Consent, Feedback and Finance

This milestone connects the patient Flutter app to the existing patient, quality, insurance and payment services. It adds no service or database schema. Acceptance used synthetic local fixtures only; no real patient data or money movement was involved.

## Capability status

| Capability | Status | Verified behavior and limits |
|---|---|---|
| Consent list, grant and revoke | WORKING | The patient UI lists persisted records, grants and revokes consent through the patient service, reads the same record back, and retains revoked records after refresh. |
| Consent ownership and supported scopes | WORKING | Patient A can manage their own consent; Patient B receives 403/404 for Patient A's records and cannot revoke them. Unsupported scope is rejected with HTTP 422. |
| Cross-service consent enforcement | PARTIAL | The emergency dispatch context checks for active, unrevoked `emergency_responder` consent. Regression coverage verifies active consent avoids break-glass and revocation switches dispatch to audited break-glass. This is a narrow emergency policy, not platform-wide authorization enforcement. |
| Consultation rating | WORKING | One rating is accepted for a completed, owned consultation. A duplicate returns `ALREADY_RATED`; an incomplete consultation is rejected; Patient B cannot rate Patient A's consultation. There is no rating read endpoint, so a rating cannot be reloaded after leaving the response state. |
| Complaint / incident submission | WORKING | The Flutter form submits to Quality and displays the persisted reference and status. A real Firefox platform-admin login found the same incident in the existing Admin incident queue, and the matching persisted ID was verified through the admin API. |
| Patient incident status read or reopen | NOT SUPPORTED | Patient access to the admin incident list returns 403. There is no patient-owned incident status/reopen API or admin resolution action in this workflow. |
| Insurance coverage and claim history | WORKING | The patient screen reads the same persisted synthetic coverage and submitted claim on repeat reads. Patient B cannot read Patient A's coverage or claim. |
| Patient claim submission or adjudication | NOT SUPPORTED | A live Patient A claim submission is rejected with 403. Claim submission remains limited to the clinician who delivered the consultation or a platform admin; there is no patient adjudication action. |
| Payment history | WORKING | The patient screen reads and renders the same persisted synthetic payment record on repeat reads. Patient B cannot read Patient A's payment or intent and cannot cancel it. |
| Patient payment intent | NOT EXPOSED IN PATIENT APP | No authoritative backend quote exists. The UI does not accept a patient-entered amount or create an intent. A generic authenticated backend intent route still accepts caller-supplied amounts; this acceptance does not invoke that route from the patient app. |
| Payment provider / money movement | LOCAL/MOCKED | The development adapter is local/console/mock. A stored `succeeded` status does not show that external funds moved or an insurer paid. |

## Staff visibility

The existing Staff Web page at `/admin/incidents` displays incident reports to platform administrators. It does not resolve or close them. The acceptance screenshot is stored in the ignored local path `Web/.local/evidence/admin-same-patient-incident.png` and is not part of Git changes.

## Verification record

- Session-gated live Flutter acceptance passed with legitimate development OTP sessions for two synthetic patients. It covered consent list/grant/revoke/read-back, rating and negative rating cases, incident submission, insurance and claim reads, payment reads, and Patient B ownership denials.
- Real Firefox Staff Web login as `platform_admin` passed. The Admin page showed the same submitted incident; the exact persisted incident ID and description matched the Quality API result.
- Patient A's attempt to list Admin incident reports returned 403. The Quality API has no incident resolution route for patients.
- Patient A's claim submission and payment refund attempts returned 403; Patient B's attempt to grant Patient A consent returned 403/404 as expected.
- Patient, Quality, Payment and Emergency database-backed suites passed against the isolated `ahealth_test` database on port 55434. The test runner verified the connected database name before running tests.
- `flutter test --no-pub`: 56 passed; 4 session-gated tests skipped in the normal run. The live acceptance was run separately and passed.
- `flutter analyze --no-pub`: 29 existing info-level findings remain in files outside this milestone; zero errors and zero findings in milestone files. The analyzer exits nonzero because those existing findings remain.
- Patient, Quality and Payment service builds passed earlier in closeout; no service implementation source changed afterward. The Emergency change is a focused regression test only.
- Runtime environment, sessions, database contents, test logs and screenshot remain local and ignored. No credentials, OTPs, tokens, database data or screenshots are intended for Git.
