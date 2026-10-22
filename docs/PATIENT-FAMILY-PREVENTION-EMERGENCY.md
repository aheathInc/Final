# Patient Family, Prevention and Emergency

Scope: patient Flutter app using the existing families, education, prevention and emergency services. No backend schema or service code was changed. All acceptance records are synthetic and stored in the isolated `ahealth_dev` database on port 55432.

## Acceptance status

| Area | Status | Evidence |
|---|---|---|
| Family and dependants | PASS | Patient A authenticated once through development OTP. The live Flutter test rendered the existing family/head, created one synthetic dependant through the patient screen, read it back, linked it as `child`, and rendered that relationship. No duplicate dependant was created when resuming acceptance. |
| GP / OB-GYN assignments | PASS | Verified synthetic GP and OB-GYN assignments were read from `/families/me` and rendered in the patient Family screen. |
| Family authorization | PASS | Patient A's admin-only family assignment write was denied. Patient B could not read Patient A's family, dependant, profile, prevention records, or emergency. Ownership results are in ignored `Web/.local/evidence/ownership-authorization.json`. |
| Education | PASS | Test-only instrumentation traced API status 200, JSON decode, model parsing, successful widget state, and rendering of the same published article. The draft is omitted from the public list and its detail endpoint returns 404. Root cause was the live Flutter test starting HTTP requests inside the widget test `FakeAsync` zone; pumping the live widget within `tester.runAsync` lets real socket I/O complete. Production networking and API responses were not weakened or replaced. |
| Screening | PASS | The same pending invitation was answered `deferred`; the patient screen rendered the persisted status. |
| Vaccination | PASS | The existing synthetic administered record was read and rendered in the Vaccinations screen. |
| Risk / prevention | PASS | The same backend risk score and service category were read and rendered without diagnosis or clinical interpretation. |
| Emergency request | PASS | One request was created with explicit synthetic, nonzero manual coordinates through the production API/model path. The same ID and `reported` status were fetched, entered into the patient status lookup, rendered, and refreshed. GPS acquisition is not claimed. |
| Admin visibility | PASS | Real Firefox Staff Web admin login displayed the exact same emergency request on `/admin/emergency`; screenshot: `Web/.local/evidence/admin-emergency-same-request.png`. It was not dispatched. |
| Emergency ownership / RBAC | PASS | Patient B was denied access to the same emergency. Existing clinician checks denied platform-admin emergency actions. |
| Dispatch | LOCAL/SIMULATED DISPATCH ONLY | No external responder, ambulance, or ETA integration is claimed; no dispatch was triggered. |
| First aid | NOT SUPPORTED | No approved first-aid asset or authoritative content was found. No medical guidance was fabricated. |

## Implementation

- Added patient Family and Education screens/navigation, family API routing, and parsing helpers.
- Updated screening to display backend invitation status/actions and service-generated risk values.
- Updated vaccination display to use active-profile records.
- Updated Emergency/SOS to validate coordinates and persist/read request status through the existing service.
- Added deterministic parsing/unit coverage and a session-gated live Flutter acceptance test. The live test uses a test-only `HttpOverrides` and real API calls; it does not mock responses or alter production networking.

## Verification

- `flutter test --no-pub`: 44 normal tests passed; 3 session-gated live tests skipped in the deterministic suite.
- Dedicated Education live widget test passed separately; full Patient A live acceptance passed separately after login/session setup.
- Education trace: request started; HTTP 200; body decoded; model parsed; widget state succeeded; published article rendered; draft detail returned 404.
- Patient A positive journey passed using one OTP session, refreshed through the supported refresh-token flow when its access token expired.
- Patient B ownership checks passed using one OTP session. No rate limiter state was reset or bypassed.
- Admin same-request visibility passed in Firefox. No dispatch occurred.
- `flutter analyze --no-pub`: 29 historical findings outside milestone files; zero analyzer errors and zero findings in milestone files.
- `git diff --check` passes. Acceptance credentials, sessions, and screenshots/evidence remain under ignored `Web/.local/`.
- No commit, push, or merge was performed.
