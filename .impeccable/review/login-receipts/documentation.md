# Login, biometrics and receipt documentation handoff

Date: 28 October 2026.

Outcome: ordinary refinement of the incumbent Flutter Android interface. The fresh `login_receipts_finish_reviewer` handoff reports **SHIP**, with no material fixes. Existing Material/teal design authority remains intact; absent global PRODUCT.md/DESIGN.md files were not invented, and no design sidecar or new tokens were created.

## Evidence checked

- Read `contract.md` and `docs/mobile-login-and-receipts.md`, using the documenter instructions/reference already read in this session.
- Inspected the known-account behavior in `apps/patient-mobile/lib/screens/login_screen.dart`; biometric placement and receipt entry in `security_screen.dart`; Profile and paid-bill entry points in `profile_screen.dart` and `payment_bills_screen.dart`; and the shared `biometric_settings.dart` and `receipt_download.dart` widgets.
- Checked remembered identity and account-bound biometric preference handling in `lib/core/session.dart`, and receipt response validation/account-change/lock guards in `lib/core/api.dart`. No working-tree change exists in `lib/core/theme.dart`.
- Inventoried six native PNGs. Directly inspected `returning-login.png`, `biometric-settings-dark-large.png`, and `registration-receipt.png`, plus the existing `.local/receipt-review/receipt-sample.png` preview. The preview shows a synthetic payer, prominent simulation banner, original payment, refund and net amounts without clinical details.
- Independently compared SHA-256 hashes of `.local/receipt-review/receipt-from-phone.pdf` and `receipt-sample.pdf`: both are `054579C2EA076153185D68A0F1DD8F60DD9066E5B6ABB65D2B3E297CA0B27981`.
- Read `.local/biometric-hardware-result.json`: device `Pixel 4`, `nativeBiometricAuthentication: true`, checked at `2026-10-28T07:31:07.923Z`. This explicit hardware result is separate from UI fixtures and fake-platform widget tests.

## Incumbent system retained

Palette: existing teal actions and light/dark surface and text roles.

Typography: existing Material heading, label and body hierarchy.

Layout: existing scrollable account/security forms and familiar Profile/bill entry points.

Controls: shared filled/outlined actions, password visibility, notices, biometric settings and PDF download feedback.

Behavior: remembered identity without storing a password; optional authenticated biometric opt-in; explicit password/OTP fallback; truthful receipt save/cancel/failure messages.

## Acceptance and limits

The implementation handoff reports three isolated backend database/HTTP tests and four Flutter widget tests passed, followed by current-source physical Pixel 4 acceptance for returning login, settings and PDF save. The actual Android file picker saved the synthetic receipt in Download; the retrieved PDF hash matches the renderer fixture as verified above. APK version 2004 was successfully installed with the strict `adb install -r` update workflow, according to the parent handoff.

The six native captures use synthetic API/secure-storage fixtures. Their visual states do not independently prove live backend identity persistence, payment settlement, every biometric failure/recovery case, or broad device support. Successful biometric hardware authentication is supported specifically by the separate Pixel 4 result file. Real SMS/payment provider verification and iOS export/settings integration are not claimed. This documentation pass did not rerun tests, interact with the device, or render new images/PDFs.

No unrelated visual drift was repaired or canonized. Changed file: this handoff only; implementation documentation, application code and global design files were left untouched.
