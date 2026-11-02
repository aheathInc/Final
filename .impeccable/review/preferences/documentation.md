# Preferences documentation handoff

The fresh reviewer identified one documentation fix: app PRODUCT/DESIGN still described system-only appearance and Swahili-oriented interface guidance. The narrow update now records patient-selectable Kiswahili/English/French and System/Light/Dark, the Kiswahili/System defaults, device persistence and offline operation. It preserves the incumbent visual world and every palette value. No application source, global sidecar or unrelated feature was changed.

## Evidence checked

- This directory's contract, app PRODUCT/DESIGN and all five existing native PNGs.
- `core/app_preferences.dart`, `core/l10n.dart`, `screens/app_settings_screen.dart`, preference/localization wiring in `main.dart`, login globe and Profile entry, `core/strings.dart`, a catalog sample and focused preference test cases.
- Personal editor language metadata inspected narrowly to confirm French remains separate from device UI choice.

The source supports persistence before applying a change, settings saving/error feedback, Material locale/theme updates and unchanged placeholder values. Unfinished medication work was excluded; no broad localization or gesture audit was performed.

## Retained system

1. Palette: existing petrol/mint/paper and dedicated light/dark semantic colors, unchanged.
2. Type: Material/system hierarchy with native scaling and translated-label wrapping.
3. Controls: familiar grouped radio choices with recognizable language autonyms.
4. Surfaces: existing ProfileCard tonal gradients/shadows and bounded scrolling settings.
5. Meaning: interface localization preserves authored clinical/user content; communication metadata stays separate.

The documented preference expansion resolves the identified stale guidance. No unrelated drift was repaired or defect promoted into a design rule; final reviewer disposition remains the reviewer's responsibility.

## Verification and limits

Parent-confirmed: 189 Flutter tests passed/eight existing skips, 14 focused tests passed, no whole-library analysis errors/warnings (style information remains), and clean targeted preferences analysis. Normal APK 2011 installation/version was confirmed on physical Pixel 4. Review images instead come from normal APK 2011 on the Pixel 10 Pro XL Android 37 emulator via direct adb screenshots with system bars and no patient data.

Kiswahili/English settings images explicitly show transient saving; French settings is stable with enabled controls and no progress bar. Native French font scale 1.3 and French login were checked after cold start; scale was restored to 1.0. No complete physical-phone navigation/gesture acceptance, tablet/landscape or live authentication is claimed. No new screenshots were produced here.

Files changed: `apps/patient-mobile/PRODUCT.md`, `apps/patient-mobile/DESIGN.md`, `docs/mobile-language-and-appearance.md`, `.impeccable/review/preferences/documentation.md`.
