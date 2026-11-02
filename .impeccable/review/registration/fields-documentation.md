# Registration field correction handoff

Date: 28 October 2026.

Outcome: ordinary refinement of the incumbent Flutter Android registration. The fresh `registration_fields_finish_reviewer` handoff reports **SHIP**, with no material fixes. No global PRODUCT.md, DESIGN.md, sidecar, or theme changes are warranted.

## Evidence checked

- Read `fields-contract.md`, the existing authentication guide, and the documenter instructions/reference retained from this task.
- Inspected `apps/patient-mobile/lib/screens/registration_screen.dart` and `lib/widgets/residence_field.dart`. Date entry and calendar selection share a controller; the strict display format is DD/MM/YYYY and submission uses YYYY-MM-DD. Date, sex and consent each have their own validator. Invalid submission brings the first invalid form field into view.
- Verified residence search starts after 650 ms idle for a query of 3–100 characters. Request generations and focus checks discard stale responses; selecting a suggestion changes residence text only. Loading, no-result, failure/retry and manual-entry states remain available, with OpenStreetMap attribution.
- Checked the native integration source for typed DOB, calendar confirmation, fixture Dodoma selection, expected ISO date/residence payload, and the missing-consent regression before payment. Inventoried the five current field captures: `profile-top.png`, `residence-suggestions.png`, `registration-consent-validation.png`, `profile-contact.png`, and `registration-fee.png`. Directly inspected the suggestions and consent-validation captures.
- Confirmed no working-tree diff in `apps/patient-mobile/lib/core/theme.dart`. Existing detailed implementation documentation remains in `docs/patient-authentication.md`.

## Incumbent system retained

Palette: existing teal actions, neutral surfaces, and theme-derived field/error colors.

Typography: existing Material text roles and native field/helper labels.

Layout: existing scrollable registration form, with suggestions directly beneath residence.

Controls: existing Material text field, calendar, dropdown, consent checkbox, buttons, and list tiles.

Behavior: independent field errors, preserved draft, optional suggestions, and manual residence fallback.

## Validation and limits

The implementation handoff reports three backend tests and two Flutter widget tests passed, plus the current-source physical Pixel 4 registration flow through typed/calendar DOB, suggestion selection, missing consent, and simulated payment. A separate live Photon smoke returned genuine Dodoma labels. Native acceptance uses intercepted fixture responses; its suggestions are not proof of live provider delivery on the device. This documentation pass did not rerun tests, query Photon, or render new screens.

APK version 2003 was reported built; update installation was still underway at handoff, so successful installation is not claimed here. Actual biometric authentication, real SMS/payment providers, and new comprehensive dark/large-text or landscape coverage are not established by these field captures.

No unrelated drift was repaired or canonized. During this check the native evidence directory contained twelve PNGs, while the existing authentication guide still said ten; that stale count was flagged to the parent task because the guide is outside this handoff's write boundary.

Changed file: this handoff only. No application, global design, or existing documentation files were edited.
