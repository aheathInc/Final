# Returning patient login, biometrics and receipts

Returning patients on a known phone see their remembered account and a password field without typing the phone number. The identifier is retained in platform secure storage only after a successful patient login or registration. It is not a credential: the backend still verifies the password or OTP. First use requests a phone number through explicit linking/registration. Per the user's follow-up, the “Tumia account nyingine / sahau account hii” control is removed from login, and the primary action is “Ingia” with the Material login icon. No password is stored.

Default login now contains no phone input even on an unlinked device. Without a remembered account it offers explicit “Unganisha account yangu” and “Mgonjwa mpya? Sajili account” actions. Only these separate routes show the phone input, with a linking/registration app bar; system Back returns to the field-free login. An unknown device still needs a one-time verified account identity before password/biometric login can work.

Follow-up correction: five targeted widget tests passed, including unknown-device default, both explicit routes and Back. Dart analysis passed. APK version 2005 was installed with `adb install -r`; direct screenshots from the normal installed app on Pixel 4 confirm the field-free default and contextual linking/registration pages. An attempted automated screenshot fixture stalled and was removed; it is not counted as passing native automation. Evidence and handoff: `.impeccable/review/login-entry/`.

Login-control follow-up: the user-requested removal and “Ingia” icon action are included in APK 2006, installed successfully using `adb install -r`. The existing five widget regressions and targeted Dart analysis passed. Current-source native preview on Pixel 4 confirms the final control text/icon and removed action with synthetic storage; no real account data is changed by that preview. Evidence: `.impeccable/review/login-label/`.

Biometrics remain an opt-in for the current authenticated account on that device. Profile has a visible Face/Fingerprint entry; Security puts the biometric controls above password changes. An Android enrollment shortcut opens the operating system's biometric settings, and availability refreshes when the user returns. The preference is enabled only after a successful biometric-only system prompt. Face/fingerprint templates stay with the OS. Unsupported or unenrolled devices retain password/OTP access.

Cold start and backgrounding lock the app when enabled. A password fallback or session expiry preserves the preference for the same user; signing in as another user disables it. Explicit sign-out disables biometric session access while retaining the remembered account identifier. Biometrics alone do not recreate a revoked server session.

## Downloadable payment receipts

- `GET /payments/bills/:bill_id/receipt`: an active payer or active platform administrator may download the receipt for a settled bill. Other patients receive 404. A stale JWT cannot bypass a suspended account check.
- `GET /payments/registration/receipt`: a valid restricted enrollment token may download only its own registration receipt, including before password setup. Expired/consumed enrollment tokens are rejected.

Both return an attachment with `application/pdf` and `Cache-Control: no-store`. Pending, failed and unpaid requests cannot produce receipts. Amount, currency, settlement time and transaction reference come from the stored payment. The receipt number is stable across repeated downloads. Partial/full refunds retain the original paid amount and show current refunded/net amounts. Receipts exclude diagnosis, residence, next of kin, phone and other clinical details.

Simulated and test payments carry a prominent “MAJARIBIO - SI UTHIBITISHO WA FEDHA HALISI” banner. Legacy payment environments are labelled as unconfirmed live status. No fiscal registration numbers, tax claims or provider verification claims are fabricated.

Patients can use “Pakua risiti (PDF)” after registration payment, before/after password setup, or later in “Bili na risiti”. The Android system file picker lets them choose the filename/location. Cancellation does not claim success. Download responses are discarded if the account changes or the app locks while fetching. The native handler validates a PDF header, bounded bytes and a safe filename; no broad storage permission is requested.

Receipt generation uses PDFKit and embedded Noto Sans (SIL OFL license retained in `services/payment/assets/OFL.txt`). The Android save/enrollment channel is implemented in MainActivity; equivalent iOS file export/settings integration is not implemented or tested in this change.

## Validation

Three isolated PostgreSQL/HTTP receipt tests passed: ownership/authorization and PDF headers, unpaid/expired enrollment rejection, and partial/full refund rendering. Four Flutter regressions passed: remembered account/password login and account switching, enrollment shortcut plus failed/successful biometric opt-in, cancelled PDF save, and an identity change during download. The biometric prompt in unit tests is a fake platform implementation; real sensor authentication must be reported separately.

The synthetic receipt PDF was rendered and visually inspected as one A4 page, including non-ASCII payer text, simulation banner and refund totals. It contains no real patient or transaction. On the physical Pixel 4, native acceptance passed password-only remembered login, light/dark/1.3-scale settings and Android PDF export. The system Save dialog wrote the fixture into Downloads; its SHA256 exactly matched the server-rendered PDF. APK version code 2004 was installed with `adb install -r`.

A separate actual biometric prompt succeeded on Pixel 4 at 2026-10-28T07:31:07.923Z. The diagnostic invoked the app's real `Biometrics.unlock()` against the OS and observed the synthetic lock change from locked to unlocked; it did not fake the biometric platform. This confirms real sensor authentication, separate from the synthetic secure-storage account used by acceptance. It does not imply every patient has opted in or that a revoked session can be restored by biometrics alone. Evidence: `.local/biometric-hardware-result.json` and `.impeccable/review/login-receipts/documentation.md`.

## Reference-led login layout

The latest layout adapts the interface inside the user's reference phone: an underlined page heading in the header, a continuous form surface with rounded top corners, centered identity/welcome, outlined fields, a prominent primary action and a quiet footer. It uses A-Health identity rather than the reference's HESLB/government marks, and does not reproduce the surrounding poster or phone hardware.

The user explicitly requested design changes without changing colors. `LoginShell` therefore reuses existing `AppPalette` colors and system light/dark roles; `lib/core/theme.dart` is unchanged. The app's existing `apps/patient-mobile/PRODUCT.md` and `DESIGN.md` remain the design authority. Local geometry and type sizing adapt the reference to native phone use without replacing the global visual system. Known-account login remains password-only, unlinked default login remains phone-field-free, and explicit link/registration routes, Back, password visibility, OTP recovery, busy/error handling and the "Ingia" icon action remain available. The removed switch/forget control is not restored.

Six final Flutter widget regressions and targeted Dart analysis passed, including a 320x640 viewport, 1.3 text scaling and simulated keyboard insets. Three current-source Pixel 4 previews (`login-dark.png`, `login-light.png`, `login-large.png`) use synthetic secure storage and intercepted requests. A subsequent `Flexible` guard around the centered brand label preserves the captured appearance while allowing narrow layouts to accommodate text. Fresh scoped visual review returned **SHIP** with no material fixes. APK version 2007 built and installed successfully with `adb install -r`, and the normal app was cold-launched. Device preferences were restored to `font_scale=0.85` and `night=yes`.

The native keyboard was not captured, and this layout task does not establish new real-account authentication or biometric/provider acceptance. Widget keyboard-inset coverage is distinct from physical keyboard evidence. Reference, captures and documentation handoff: `.impeccable/review/login-reference/`.

## Biometric session renewal fix (2009)

The API client now shares one refresh operation per session identity. Concurrent requests and PDF downloads no longer independently present the same rotating refresh token. A late rejection for an old access token retries with the already renewed token. This prevents the client's own concurrent requests from triggering the server's token-reuse revocation.

Connection failures and temporary service errors during renewal propagate without clearing credentials or biometric preference. Explicit server authentication rejection still requires sign-in. Identity guards reject old responses and late refresh results after account changes; a biometric result only unlocks the same identity when a session remains present. Biometrics cannot restore a session that the server has already revoked, so such an account needs one successful password/OTP sign-in.

Seven focused tests cover biometric success with concurrent expiry, delayed old-token rejection, network failure, service outage, real rejection, logout during renewal, and identity change during biometric authentication. Together with the six login/receipt and seven profile regressions, all 20 tests pass. The biometric prompt is mocked in these tests; this fix does not claim a new physical Face Unlock acceptance run. Logs are `.local/biometric-session-final-tests.log` and `.local/biometric-session-analyze.log`.

Normal APK 2009 built, passed targeted analysis, and updated Pixel 4 through `adb install -r` successfully. The installed package version was confirmed and the normal app cold-launched. `.local/biometric-session-verification.json` records this installation and the verification limits.
