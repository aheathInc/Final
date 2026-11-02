# Patient medication follow-up

The patient medicines entry opens **Dawa na ufuatiliaji**. The screen supports the device's Kiswahili, English or French preference and light/dark appearance. Clinical instructions, medicine names and clinician education remain in their original language.

Patients and authorized guardians can see clinician-confirmed active schedules, report Taken or Skipped, supply a skipped-dose reason and optional note, and snooze a due reminder for 5/10/15/30 minutes. Snoozing preserves the original scheduled time, increments a snooze counter and never records medicine intake. Future doses cannot be confirmed. Conflicting updates require a reload; a failed response never becomes a confirmed report in the new screen.

The rolling 7/30-day summary divides explicitly reported taken doses by all due doses in the window. Future doses are excluded; with no due doses the percentage is unavailable (shown as a dash), not zero. Summary counts keep explicit skipped, delayed and unconfirmed doses separate. The daily chart combines delayed and unconfirmed in its neutral segment labelled unconfirmed because neither supplies a final Taken/Skipped report; the summary is the source for the separate delayed count. Daily trend dates use Africa/Dar_es_Salaam and are labelled accordingly. Percentages describe patient reports, not independently verified ingestion or clinical outcomes. Only active, confirmed plans contribute; the summary is not a historical prescribing audit.

Clinicians may supply an HTTPS medicine image and education text when closing the consultation. Neither the app nor the backend invents pill images, side effects or instructions. A neutral medicine icon represents missing imagery. Stock is an explicit patient estimate: baseline quantity, unit label, optional units per dose and a low-stock threshold. Only confirmed taken reports after that baseline decrement the estimate, using the explicitly supplied units per dose. With no units per dose the baseline remains unchanged; dosage text is never parsed into a stock count. This is separate from pharmacy inventory.

The nearby-dose list shows up to 60 doses within one day before/after the current time, with the full calendar still linked. Snooze is limited server-side to due, unconfirmed doses from the preceding 24 hours. The medicine summary returns up to 100 items and flags truncation; the screen links to all prescriptions/pharmacy. A low-stock notice asks the patient to contact a pharmacy or hospital: it neither orders a refill nor confirms availability or delivery.

The new follow-up repository uses direct online requests for reports, snoozes and supply updates; these actions are not added to the offline outbox. The linked legacy calendar retains its existing offline-outbox behavior. The new screen adds no persistent cache of summary/dose data. A failed refresh can retain already loaded in-memory data alongside an error; a first-load failure does not become a zero-adherence or empty-medication claim. Existing native reminder alarms are cached independently and can remain scheduled during a temporary network failure. Account changes clear the visible selection/data and reject late results from the former identity.

## Android reminders

The patient opts in on the device and grants notification permission. The app caches up to 400 upcoming reminders, with the last cached time shown on screen. The Android implementation schedules generic notifications on a high-importance channel for delivery when the app is closed, restores scheduled alarms after reboot/time changes, and clears active reminders when the account changes or signs out. The opt-in preference is stored per account on the device. Notifications contain no medicine or patient names. Opening one enters the authenticated app; it does not confirm a dose. Actual timing and audibility depend on device settings and runtime verification.

The device's notification sound, Do Not Disturb, battery management and alarm permission can affect delivery. Without exact-alarm access the app explicitly warns that reminders may be delayed and offers the Android settings entry. Force stopping the app can suppress alarms until it is reopened. These follow [Android alarm rules](https://developer.android.com/develop/background-work/services/alarms) and [exact-alarm permission behavior](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms).

The schedule refresh is requested while the unlocked app is opened/resumed, with ordinary successful refreshes throttled to five-minute intervals; enabling reminders and successful screen actions force a refresh. Server changes made while the app remains offline cannot update already cached alarms. Coverage is finite, not an indefinitely synchronized schedule. No FCM medication push delivery or background polling is claimed. Low supply shows an in-app notice and, when reminders are enabled, notification permission is granted and the summary is fetched, a generic native notification once per stock baseline. Reopening the screen does not repeatedly notify the same baseline. No background refill prediction is claimed.

SMS preferences remain accessible in the full calendar. The existing SMS adapter must have a real provider configured before actual delivery can be promised; console simulation is not delivery. No WhatsApp messages are sent by this feature. The registration task established that no real provider is available yet. Provider credentials belong in environment configuration, not source or chat.

## Backend and storage

Additive migration `20261028150000_medication_followup` adds clinician image/education, skip reason, snooze time/count and patient-reported supply baselines. Existing reports remain valid. Legacy endpoints retain compatibility with older clients that omit a skip reason; the new follow-up screen requires it.

Authenticated routes in the follow-up service:

- `GET /care-continuity/medication-summary?days=7|30&patient_profile_id=…`
- `GET /care-continuity/medication-alarms`
- `POST /care-continuity/doses/:id/snooze` — base version and minutes
- `POST /care-continuity/items/:id/supply` — base version and explicit stock values
- Existing `POST /adherence-logs/:id/confirm` accepts optional `skip_reason` with a skipped report.

Patient/guardian ownership is checked server-side. Stock and snooze writes use existing care-plan transaction locks, versions, idempotency handling and audit records. Final reports cannot be snoozed or overwritten with another final status. No reminder action alters prescribed medication or grants access to another patient's records.

## Verification and delivery

Pure backend tests cover denominator/status separation, bounded snooze inputs and finite/precise stock values. A retained isolated PostgreSQL test schema exercises actual ownership, stale versions, unchanged scheduled times, final-report guards, idempotent retry, reasons, stock decrement and summary. It contains synthetic records and does not reset or edit live patient records. Mobile tests cover future-dose guards, snooze semantics, reason requirement, decimal stock input, server conflicts, account isolation, narrow large text and unavailable-data states.

Final reported validation: 197 mobile regression tests passed with eight existing skips, eight focused mobile tests passed, four pure backend tests passed, and the isolated PostgreSQL schema test passed. Follow-up, consultation and staff-web TypeScript checks passed; targeted analysis found no issues. The normal `lib/main.dart` APK build 2012 succeeded. The physical device remained disconnected, so no physical build-2012 installation is claimed. Normal emulator APK restoration and service restarts were still underway at this handoff.

Fresh visual review in `.impeccable/review/medication/review.md` returned `ship`, with no material fixes, for eight native phone-portrait captures: Kiswahili, English, French dark, French large text, dose, skip, stock and unavailable/offline views. Captures used a per-launch Skia emulator flag after Impeller caused focus ANRs; default-renderer performance is not established. Tablet/landscape and physical-phone visual acceptance remain unclaimed.

Separate functional emulator evidence confirms real Android notification permission acceptance and an AlarmManager-scheduled synthetic event set 20 seconds ahead. `phone-native-notifications.png` shows both generic dose and refill notifications without medicine or patient names; `phone-notification-enabled.png` shows consent enabled, cached coverage and the exact-alarm warning. This proves the exercised native notification path, not exact timing, audible delivery, reboot recovery, physical-device reliability or live-provider delivery. The notification images were captured after the eight-image visual review and are outside that verdict.

`integration_test/medication_preview.dart` is an emulator-only synthetic harness using the production screen and real Android host, not browser/HTML or edited images. Its TEST control is excluded from the normal deliverable; the harness must never be distributed as the app. Build the deliverable with `--target=lib/main.dart`; `adb install -r` preserves installed data when an update is performed. No real patient data or live SMS/WhatsApp delivery is claimed by these captures.

## Incumbent design

The screen retains existing AppPalette light/dark colors, Material controls and system typography, scoped ProfileCard gradients/shadows, 720 dp bounded scrolling content and wrapping actions. The percentage is a local 40 sp emphasis within the existing hero treatment; trend bars carry labelled report counts rather than clinical status. Interface text follows the existing Kiswahili/English/French setting, while clinician content remains unchanged. This extension requires no new global palette, typography or design-world rules.
