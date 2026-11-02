# Mobile language and appearance

Patients can open Language and appearance from Profile or the login globe icon, including before authentication. Language choices are Kiswahili (`sw`, default), English (`en`) and Français (`fr`). Appearance choices are System (default), Light and Dark. Existing A-Health palettes, Material controls and navigation remain.

`AppPreferences` restores the device choices at startup from secure-storage keys `ah_ui_language` and `ah_ui_theme`. Changes work offline. A successful storage write updates the locale/theme immediately through the existing app tree; navigation and drafts are retained. While saving, settings controls are temporarily disabled with a progress indicator. Storage failure displays an error instead of claiming success. These preferences are device settings, not server-synchronized patient metadata.

`L` loads the bundled authored-interface catalog; `MaterialApp` supports `sw`, `en` and `fr` with Flutter Material localizations. Date formatting follows the selected locale. Translation substitutes placeholders without translating their values. Clinical records, clinician/patient messages and other authored content retain their source text. Server-authored medical articles remain in their original language, with that limitation labelled. The personal editor's preferred communication language is separate account metadata and includes French; changing the device UI language does not save that profile field.

## Verification

Parent-confirmed results for the preferences scope: 189 full-suite Flutter tests passed, with eight existing skips; 14 focused tests passed. Coverage includes persistence/restoration, live switching, navigation/draft retention, catalog placeholder parity, clinical-text preservation and narrow French settings at large text. Whole-library analysis had no errors or warnings but retained style/const information messages; targeted preferences/controller/catalog/settings analysis was clean.

Normal APK 2011 was installed on physical Pixel 4 with `adb install -r: Success`, and its installed version was confirmed. The phone was subsequently disconnected and in use; it supplied no review captures for this feature.

The five PNGs in `.impeccable/review/preferences/` are direct `adb screencap` captures of normal APK 2011 on a Pixel 10 Pro XL Android 37 emulator, including system bars. They are neither HTML renders nor edited images and contain no patient data:

- `phone-settings-sw.png` and `phone-settings-en.png` show transient saving states, with temporarily disabled controls and a progress bar; they are not stable idle-state evidence.
- `phone-settings-fr.png` shows stable French/Dark selection, enabled controls and no saving bar.
- `phone-settings-large-fr.png` shows French settings with native font scale 1.3 after cold start; scale was restored to 1.0 afterward.
- `phone-login-fr.png` shows the normal unlinked-account login in French after cold start.

These checks do not establish every gesture or every screen on a physical phone, tablet/landscape layouts, live authentication, or translation of medical/user-authored content. The unfinished medication follow-up work is outside this handoff. The catalog count reported for the shipped preferences work was 1,073 interface keys; subsequent medication additions are not part of this evidence.
