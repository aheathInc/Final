# Patient Profile tab

The `Wasifu` tab opens `ProfileScreen` directly inside Home. Home retains its bottom navigation on phones and navigation rail on expanded layouts. The profile is a compact account hub; personal and medical editing use separate pushed screens with Back navigation.

## Overview and destinations

The identity card shows the supplied name, phone, age/sex and residence when available, with initials or a person icon and `Hariri taarifa`. It does not invent a completion score, account status or clinical summary. Refresh is available in the app bar and by pull-to-refresh.

The next actions are `Taarifa za afya` and `Bili na risiti`. Grouped rows retain the existing destinations:

- Account security, password and biometric settings; privacy and consent; insurance and service payments.
- Family/dependents, health history and locally saved clinical advice.
- Feedback/support tracking, followed by sign-out.

Unknown dependent counts remain descriptive text rather than zero. Signing out attempts the existing logout endpoint and clears the local session even if the network request fails.

## Editors and save behavior

Personal editing updates only full name and preferred communication language (`sw` or `en`) through `PATCH /users/me`, with the account's `base_version`. Phone, date of birth, sex, residence and next-of-kin details appear as read-only registration information when present.

Medical editing updates allergies, chronic conditions and emergency contact through `PATCH /patient-profiles/me`, with the medical profile's `base_version`. Comma-separated lists are trimmed and deduplicated; an empty emergency contact becomes null. Personal and medical updates are separate requests and do not overwrite each other's fields.

Editing requires successfully loaded current account/profile data and connectivity. Saves recheck connectivity and do not enqueue an offline edit. A successful save returns to the hub, reloads its data and displays confirmation. A failed or unconfirmed save remains in the editor with an error.

A 409 conflict preserves the draft and disables saving until `Pakia taarifa za sasa` reloads current records. A successful reload replaces the draft with the latest server values; the patient must reapply changes before saving. A failed reload preserves the draft and reports that it could not fetch the records. There is no automatic merge or silent overwrite.

## Offline advice and account ownership

The hub reads cached advice and its last sync timestamp using the signed-in owner's ID. `SavedAdviceScreen` identifies the content as a device copy, displays the last sync time when available, and distinguishes an empty cache from a cache-read failure. It preserves supplied advice and red-flag instructions without generating clinical content. Current profile editing is disabled offline; saved advice remains readable.

The hub tracks request generation and session identity revision, clears displayed data when identity changes, and rejects late results from an earlier identity. The advice screen hides the old account's content on an identity change. An open editor also hides its fields and draft immediately, displays an account-change message and blocks further saves. Profile PATCH requests carry the expected identity revision; the API guard checks it before transport, including the refreshed-token retry. These UI protections complement existing server authorization.

## Scoped visual treatment

The app's existing `PRODUCT.md`, `DESIGN.md` and `AppPalette` remain authoritative. `ProfileCard` uses the existing hero gradient for the identity card and a subtle surface-to-mint blend for other cards. The local profile component has 20 dp rounded corners and a soft downward shadow (22 dp blur, 9 dp offset; deep-ocean opacity 0.10 light / 0.28 dark). This is the requested profile treatment, not a replacement for global card tokens.

Material controls and the system type family remain. The hub is bounded to 720 dp; editors to 640 dp. Action cards stack below 350 dp available width or above 1.15 text scale. Light/dark appearances use existing theme colors.

## Verification and limits

The six files in `.impeccable/review/profile/` cover light/dark top and lower content, 1.3 text scaling, and the personal editor. They are physical Pixel 4 native fixture renders exported from Flutter's application repaint boundary at 2x. The synthetic standalone route excludes production bottom navigation, OS bars and keyboard. These images establish application layout, not full-device insets, keyboard behavior, real authentication or actual patient writes. Production Home integration was checked in source. Tablet/landscape behavior was not visually verified.

`test/profile_screen_test.dart` contains seven focused tests: separate account writes, medical conflict/reload/retry, owned offline advice, stale profile response rejection, hiding an old editor draft, narrow 320 dp/1.3 text with a long name, and identity rejection before API transport. All seven passed, as did six login/receipt regressions. Targeted analysis found no issues, including the final Home/editor changes. No live patient write was tested for this refinement.

The fresh visual reviewer recorded `ship` with no material fixes in `.impeccable/review/profile/review.md`. The normal `lib/main.dart` APK version 2008 built and was installed on Pixel 4 with `adb install -r: Success`; the installed version and running normal application process were confirmed. `.impeccable/review/profile/verification.json` records the build target, installed version and final verification results. Installation is separate evidence from the synthetic fixture captures and does not establish a live profile write.
