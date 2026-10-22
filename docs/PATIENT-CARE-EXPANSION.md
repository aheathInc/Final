# Patient Care Expansion

Branch: `feat/patient-care-expansion`, based on `eb59bc0`.

## Appointments - WORKING (core acceptance)

- Patient authenticated through the development OTP flow, read verified clinicians and a published synthetic slot, booked it, and read the same persisted appointment from list and detail.
- A second booking attempt for the occupied slot was rejected with the backend conflict response. The client preserves the conflict rather than reporting success.
- Firefox Staff Web showed the same appointment under `/doctor/appointments`. The patient cancelled that appointment and confirmed the cancelled state on read-back.
- Verified endpoints/services: doctor (4003), appointment (4004), Staff Web BFF. Mobile rescheduling is NOT SUPPORTED because no backend operation exists.
- Git-ignored Staff Web evidence: `Web/.local/evidence/doctor-appointments.png`.

## Diagnostics and results - WORKING (acceptance), with access-control fix

- The development clinician created one synthetic point-of-care order on an existing synthetic care context. The patient authenticated through development OTP and read the same persisted order and result.
- The ordering clinician's Firefox Staff Web diagnostics list and detail showed that same order/result. Evidence is in `Web/.local/evidence/doctor-diagnostics.png` and `Web/.local/evidence/doctor-diagnostic-result.png`.
- The patient was denied result filing. Database-backed regression tests also deny an unrelated clinician and unrelated patient access. Patient responses omit clinician-only `clinical_notes`; the ordering clinician retains access to those notes.
- Result entry uses the existing diagnostics API, which authorizes the ordering clinician or platform admin. Staff Web currently has no result-entry control. No medical interpretation was created.
- Diagnostics build/type-check passed. Database-backed suite passed 17/17 against verified `ahealth_test`.

## Prescriptions and medication - WORKING (synthetic acceptance)

- One synthetic prescription was persisted through the existing consultation completion workflow for the existing synthetic patient; medication and instruction text is TEST DATA ONLY and NOT FOR CLINICAL USE.
- Patient development-OTP authentication read the same prescription from the API. The live backend payload was passed through the Flutter repository and widget acceptance; the widgets represented that same persisted prescription and linked dose.
- Flutter's test binding blocks outbound HTTP, so the local harness fetched the live payload with the authorized clinician session; the Flutter repository/widget test consumed that exact response. Patient authorization was separately verified through the legitimate OTP read-back.
- The backend completion flow created an adherence row with the matching `prescription_id`. The patient read the linked row, submitted one harmless test confirmation, and read the persisted state back. No clinical meaning is implied.
- SQLite upgrade verification preserved an existing unsynced row and stored the live adherence cache row with its prescription link and confirmed status.

## Pharmacy availability - WORKING (synthetic development fixture)

- One minimal test-only pharmacy and synthetic stock row for `AHP_SYNTHETIC_TEST_MEDICATION` were created in the isolated local development database. Synthetic coordinates were entered manually for acceptance and were not saved as patient location.
- Pharmacy 4011 returned exactly the synthetic fixture; the Flutter repository parsed the live response and the availability widget rendered only `AHP Synthetic Test Pharmacy` and its test stock state.
- Reservation and dispensing are NOT EXPOSED to patients. No reservation, purchase, or dispensing was exercised.

## Verification and limits

- `flutter test --no-pub`: 32 passed, 1 local live-acceptance test skipped without an acceptance session. The live acceptance test separately passed via the local harness. Flutter reports the existing missing `assets/first_aid/` directory; it does not fail the suite and was not changed.
- Diagnostics `tsc --noEmit` passed. Diagnostics database tests: 17/17 passed on `ahealth_test` after asserting its localhost port and database target.
- Staff Web Firefox acceptance passed for appointment visibility and diagnostic order/result visibility.
- Local routes: diagnostics 4013 and pharmacy 4011. Test-only live API payload and cache evidence remain under ignored `Web/.local/`.
- `flutter pub get` and locked `pnpm install --frozen-lockfile` resolved existing dependencies without dependency version edits. Generated Flutter plugin registrants and bootstrap-rewritten `.env.example` line-ending noise were restored.
- Test identities, local database data, logs, browser evidence and tokens remain local/ignored. No commit, push or merge was made.
