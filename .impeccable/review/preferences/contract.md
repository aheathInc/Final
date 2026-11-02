# Language and appearance preferences

User requests Kiswahili, English and French throughout the app, switchable by the patient, plus light/dark selection. Preserve incumbent A-Health identity. Prior login/profile/messages work remains.

THESIS: Offline, persistent language and appearance choices that take effect immediately without losing navigation or drafts.
OWN-WORLD: Existing app PRODUCT.md and DESIGN.md, petrol/mint/paper and native Material; user now explicitly expands system appearance with Light/Dark/System choices. No new visual world or comp.
STORY: Profile → Language and appearance; also accessible from the login globe icon before authentication. Language autonyms remain recognizable. Grouped language choices, grouped appearance choices, truthful on-device persistence note.
FIRST VIEWPORT: Current settings title, three languages, three appearance choices. French large text wraps normally. Login keeps its composition and password-only remembered-account behavior.
FORM: Android phone, Flutter Material localizations for sw/en/fr, dates follow the language, preference keys in secure storage, full offline authored interface catalog. Parameters and clinician/patient records are not machine translated. Server-authored medical articles remain in source language as labelled. Communication-language metadata in the personal editor retains its separate existing meaning and now includes French.

Required files in this folder: phone-settings-sw.png, phone-settings-en.png, phone-settings-fr.png, phone-settings-large-fr.png, phone-login-fr.png. Captured directly with adb screencap from Android37 Pixel10ProXL emulator, normal APK2011, no image editing or staged HTML. System bars included. Large text is native font_scale1.3, restored afterward. Login is an unlinked account with no patient data. Physical Pixel4 was updated2011 but disconnected/used for another app during review; it supplied no review capture. Tablet/landscape not verified. No browser detector ran.

Code-led incumbent refinement; no approved comp/new-world card. Read native reference/android.md and craft-floor.md. Existing global docs predate the explicit preference expansion and should be narrowly updated after review.

Primary sources: apps/patient-mobile/lib/screens/app_settings_screen.dart, core/app_preferences.dart, core/l10n.dart, main.dart, widgets/login_shell.dart, screens/profile_screen.dart (settings link), core/strings.dart; assets/l10n/ui.json (sample only,1,073 keys); test/app_preferences_test.dart. Localization wraps authored UI text across55 Dart files; no broad audit requested.

Evidence: full Flutter suite189pass,8existing skips; focused14pass including persistence, live switching, navigation/draft retention, placeholder parity and clinical text preservation. Whole-lib analysis has no errors/warnings but pre-existing/format const-style info remains; new preferences controller/catalog/settings targeted analysis clean. SDK flutter_localizations added, intl upgraded to SDK-required0.20.3. Physical Pixel4 adb install-r2011 success/version confirmed. Emulator captures establish normal shipped APK rather than fixture UI. New medication follow-up work is separate and unfinished; ignore its unshipped code in this review.
