# Patient authentication and registration

New patients verify a phone, enter their identity/contact details, settle one TZS 4,000 registration bill, then set a password. DOB is stored and age calculated rather than saved as a stale number. Existing active patients keep access without a new registration fee. Pending legacy patient accounts complete registration.

## State and authorization

OTP verification returns either the existing access/refresh session or `registration_required: true`, a `registration_token` and registration status. Enrollment tokens are random, hashed at rest, expire in 24 hours, rotate on another verified OTP and are accepted only by registration endpoints. They are not JWT access tokens. Pending users remain `pending_verification`; no refresh token is issued until completion. Re-verifying the phone resumes saved profile/payment state.

- `GET /auth/registration`: own current step, verified phone, profile, fixed fee, bill and current payment state.
- `PUT /auth/registration/profile`: full_name, date_of_birth (ISO date), sex, residence, next_of_kin_name, next_of_kin_phone, consent_version. Verified phone cannot be supplied/changed. Creates one server bill under a row lock.
- `GET /payments/registration/options`: configured payment processor and carriers.
- `POST /payments/registration/intents`: provider, payer_phone, optional required payer_email. No amount, currency, arbitrary bill ID or client success accepted. In-flight requests return the same intent.
- `POST /auth/registration/complete`: password and optional device_id. Requires completed profile, registration consent, paid own bill and matching succeeded, unrefunded payment. Produces the first full account session. Completion token is consumed.
- `POST /auth/patient/login`: phone_number, password, optional device_id. Five wrong attempts trigger configured lockout. Existing staff email/password login is unchanged.
- Existing OTP login allows recovery. Profile > security permits password change/reset; refresh sessions are revoked. Existing access JWTs expire at their normal short TTL. Refresh preserves password vs OTP authentication method, preventing password refresh from becoming an OTP reset credential.

No next-of-kin permission to see records is granted. Residence is free text, not invented administrative geography. The new location/contact fields are returned only through the existing authorized profile service. Community consent is separate. Guardian/dependent workflows remain available; a separate reviewed guardian-consent policy for minors is recommended before broad deployment.

## Residence suggestions and birth date

Residence now searches after 650 ms of idle typing and at least three characters. The app uses `POST /auth/registration/locations` with its restricted enrollment token; the backend verifies that token, proxies only the query to Photon, restricts results to Tanzania, deduplicates labels and returns at most five places with OpenStreetMap attribution. It does not forward identity, token, phone or GPS, and does not infer or populate district/ward/village records from a text selection. Manual entry remains available for missing places or connection failures; stale responses cannot overwrite a newer query or selection.

`LOCATION_SEARCH_URL` selects a Photon-compatible `/api/` URL without rebuilding the app. Default: `https://photon.komoot.io/api/`, a public demo with no availability guarantee; use dedicated hosting for production volume. The proxy caches at most 500 queries for 24 hours, coalesces concurrent matching queries, bounds concurrency and limits uncached traffic to two requests per second and 40 per minute per enrollment. Limits are per process; a replicated deployment needs a shared gateway budget. No search body is logged by the access logger. Official API: https://github.com/komoot/photon/blob/master/docs/api-v1.md. The public Nominatim API is not used because it prohibits autocomplete.

Birth date uses an explicit `DD/MM/YYYY` field with an optional native calendar. Calendar selection and typed entry share the same value, which is validated and serialized as `YYYY-MM-DD`. Date, sex and registration-consent errors are now independent and the first invalid control is brought into view. A missing consent checkbox no longer incorrectly asks the patient to re-enter an already valid date.

## Biometrics

`local_auth` invokes the operating system's enrolled biometrics. Face/fingerprint templates are not sent to the backend. Password is always set as a recovery credential; biometrics are optional on supported devices. The app locks on cold start and when backgrounded after opt-in. Tokens remain in existing secure storage; no password is persisted. Any enrolled biometric on that phone may unlock it, so the UI advises against enabling this on shared phones. Explicit sign-out disables biometric access. There is a password/OTP fallback. The optional-biometric and lock screens were exercised on a physical Pixel 4, but actual enrolled-sensor authentication was not tested. Physical-device biometric authentication acceptance remains outstanding.

Official integration reference: https://pub.dev/packages/local_auth (3.0.2); Android uses FlutterFragmentActivity, USE_BIOMETRIC and AppCompat themes. iOS includes Face ID purpose text but has not been built/tested here.

## Local demonstration and production

The user confirmed no SMS/payment provider exists yet. Current settings use console SMS with explicitly authorized debug OTP echo and console payment marked simulated. The mobile screen says no real SMS/money transfer occurred. Debug builds can explicitly confirm their own simulated registration payment via `/payments/registration/simulate`; the server requires a non-production console processor and local ahealth_dev DB on localhost:55432. It cannot select another patient's bill. This endpoint is unavailable for production and remote DBs. Simulation is not enabled for normal consultation bills.

Existing adapters support Africa's Talking SMS and Flutterwave Tanzania mobile money. Provider onboarding, credentials, sender registration, public HTTPS callbacks and actual end-to-end delivery/settlement verification remain deployment prerequisites. No real SMS or charge is made in acceptance tests. Production enrollment completion requires a live verified payment; a simulation record cannot activate it.

## Validation

Verified on 28 October 2026: 24 existing authentication tests and 6 enrollment tests passed; the 6 enrollment tests also passed again after login timing hardening. Auth TypeScript checking and targeted Flutter analysis passed. The native acceptance test passed on a physical Pixel 4. The normal Android APK (version code 2002) was installed using `adb install -r` and launched; a phone-originated request through USB forwarding returned HTTP 200 with database health OK. The local launcher reports 25/25 backend services and 4/4 web login routes ready. These checks do not establish live SMS/payment delivery or successful biometric authentication.

`services/auth/src/tests/enrollment.test.ts` runs only in a fresh guarded local test schema alongside the existing authentication suite. Covers restricted enrollment, expiry/rotation/resume, profile validation, unique fee, no client price/bill override, duplicate payment requests, authoritative settlement, completion replay, password login/recovery, AMR preservation, lockout/suspension and scoped simulation.

On 28 October 2026, `apps/patient-mobile/integration_test/registration_acceptance_test.dart` passed on a physical Pixel 4 using the current Dart sources after hot restart. It captures native phone/password login, simulated OTP, profile/contact, registration fee, payment-pending, password setup, optional-biometric and lock states. Assertions cover profile submission, payment-before-completion ordering, rejection of mismatched passwords, and replacement of the registration token with a synthetic account session.

The test uses intercepted synthetic API responses and mocked secure storage. It validates the native UI sequence, not live backend enrollment, real OTP delivery, payment settlement, or secure-storage persistence on the device. The OTP screen is supplied a synthetic challenge. No real SMS or money transfer occurred, and no actual biometric authentication was attempted.

Twelve PNGs are retained in `.impeccable/review/registration/native`. The lock capture uses dark mode and 1.3 text scale; this does not establish dark/large-text coverage for every registration screen. Flutter surface captures do not establish OS keyboard visibility. Fresh scoped visual review returned **SHIP** with no material fixes. The implementation preserves the incumbent Flutter Material 3 theme; no new global design system was introduced. The documentation handoffs are recorded in `.impeccable/review/registration/documentation.md` and `fields-documentation.md`. iOS and live provider acceptance remain separate work.

Residence/DOB follow-up on 28 October 2026: three search-service tests and two widget regressions passed; TypeScript checking, targeted Dart analysis and API generation passed. The updated physical Pixel 4 acceptance passed typed DOB plus calendar confirmation, place selection, missing-consent validation and continuation to payment. Live Photon smoke returned genuine Dodoma results and unauthenticated search was rejected with HTTP 401. The normal APK version code 2003 was installed successfully with `adb install -r` and launched; USB phone-to-backend health again returned HTTP 200. The update did not uninstall the app.

Recommended next improvements: provider delivery/settlement monitoring, pending-registration retention policy, and a reviewed guardian-consent flow for minors. Emergency access should remain available without making someone complete paid registration first.
