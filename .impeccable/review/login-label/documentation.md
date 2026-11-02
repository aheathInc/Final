# Login label documentation handoff

Date: 28 October 2026.

Outcome: ordinary incumbent refinement. Fresh `login_label_finish_reviewer` disposition: **SHIP**, no material fixes. The user's explicit removal of the switch/forget control supersedes earlier guidance to retain it. No global product/design files, sidecar or token changes are warranted.

## Evidence checked

Read `contract.md`, inspected the relevant branches of `apps/patient-mobile/lib/screens/login_screen.dart`, and compared the updated description in `docs/mobile-login-and-receipts.md`. The primary password action uses `FilledButton.icon`, `Icons.login_rounded`, and the label **Ingia**. The switch/forget control is absent; remembered identity, password entry, OTP recovery and separate phone-link/registration routes remain.

Directly inspected `native/login-remembered.png`. It shows the new icon/label, retained password and OTP controls, and no switch/forget action. The contract identifies this as a physical Pixel 4 current-source isolated preview with synthetic secure storage and intercepted requests, not a real account session. The incumbent `lib/core/theme.dart` has no working-tree diff.

## Retained system

Palette: incumbent teal actions and theme-derived dark surfaces/text.

Typography: existing Material title, label and body roles.

Layout: existing hero/card login composition and spacing.

Controls: existing filled-button size, native Material icon and password field.

Behavior: unchanged authentication submission and OTP recovery; user-directed removal of switch/forget UI.

## Limits

The parent handoff reports five existing widget regressions and targeted Dart analysis passed, and APK version 2006 built. Update installation was underway when this handoff began; successful installation is not claimed here. The single synthetic preview does not verify a real remembered session, live authentication, new biometric hardware behavior, or broad device/theme/text-scale coverage. This documentation pass did not rerun tests, render new evidence, interact with the device or audit unrelated code.

No unrelated drift was repaired or canonized. Changed file: this handoff only. Global PRODUCT.md/DESIGN.md remain absent under the incumbent-refinement exception; application and existing documentation files were not edited.
