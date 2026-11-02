# Reference-led login documentation handoff

Date: 28 October 2026.

Outcome: narrow adaptation within the established A-Health patient interface. Fresh `login_reference_finish_reviewer` disposition: **SHIP**, no material fixes. The user's latest instruction preserves colors and changes layout only.

## Evidence checked

- Read the actual app-level `apps/patient-mobile/PRODUCT.md` and `DESIGN.md`. These existing documents govern this task; earlier workspace-root missing-document assumptions do not apply. Neither app document was rewritten.
- Read `contract.md`, inspected `lib/widgets/login_shell.dart` and relevant `lib/screens/login_screen.dart` branches, and checked the existing implementation guide. Confirmed no working-tree diff in `lib/core/theme.dart`.
- Directly inspected the supplied 166x296 reference and all three current-source Pixel 4 previews: `native/login-dark.png`, `login-light.png`, and `login-large.png`.
- The adaptation carries over the reference's underlined header title, rounded-top continuous form surface, centered identity/welcome, outlined inputs, primary action and quiet footer. It retains A-Health identity and omits the poster framing, phone hardware, and HESLB/government marks.
- The final source includes the post-capture `Flexible` guard for the centered brand label. This is a narrow-layout safeguard; the implementation handoff reports the captured appearance is retained.

## Incumbent system retained

Palette: existing `AppPalette` petrol/mint, surface, text, action and light/dark roles; no blue recoloring or global palette edits.

Typography: Material/system face with local reference-adapted sizing and inherited text scaling.

Layout: native scrolling, bounded width, safe-area handling, rounded-top form surface and keyboard-inset accommodation.

Controls: familiar Material outlined fields, password visibility, 52 dp filled action, quiet text actions and native Back behavior.

Behavior: remembered password-only login, field-free unlinked default, explicit phone link/registration, OTP recovery, busy/error states, and "Ingia" with its icon; switch/forget remains removed.

## Validation and limits

The parent handoff reports six final widget regressions and targeted Dart analysis passed, including 320x640, 1.3 text scale and simulated keyboard insets. Final APK version 2007 built and installed successfully using `adb install -r`; the normal app was cold-launched. Device settings were restored to `font_scale=0.85` and `night=yes`.

The three physical Pixel 4 previews use synthetic secure storage and intercepted requests. They establish the supplied light/dark/large-text visual states, not new real-account authentication. The native keyboard was not captured; simulated widget insets do not establish physical keyboard behavior. Earlier biometric/provider evidence remains separate. This documentation pass did not rerun tests, render new images, or interact with the device.

No unrelated drift was repaired or canonized. Existing app product/design documents remain authoritative; no global rewrite, sidecar or competing design system was created. Changed files: `docs/mobile-login-and-receipts.md` (scoped append) and this handoff only.
