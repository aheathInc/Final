# Patient profile refinement

User request: improve the Patient App profile tab, show only useful modern-app items, professional layout, cards with gradients and drop shadows. Preserve the existing A-Health colors (prior explicit user instruction).

THESIS: A compact patient identity and account hub, with editing on separate focused screens.
OWN-WORLD: Preserve the incumbent Premium Modern Healthcare UI A in apps/patient-mobile/DESIGN.md. Petrol, mint, paper, native Material controls, light/dark. User explicitly requests gradient cards/shadows; these are approved here. No new global aesthetic.
STORY: Identity → health and receipts → account/security/privacy/insurance → family/history/offline advice → feedback/support → sign out.
FIRST VIEWPORT: Wasifu wangu, identity gradient, edit action, two useful action cards, beginning of account controls. No long form or medical notes on the overview.
FORM: Operate; native Android Flutter, phone delivery. Responsive stacking for narrow width or large text. Existing destination services and privacy/ownership behavior preserved. No invented account status, completion percentages, diagnoses, or fake unavailable counts.

Code-led incumbent refinement; no approved comp or new-world quality card exists. PRODUCT and DESIGN are in apps/patient-mobile/. Prior login reference is not a reference for this tab. No browser detector ran; native craft/platform review is the visual gate.

Required captures in this folder: phone-light.png, phone-light-bottom.png, phone-dark.png, phone-dark-bottom.png, phone-large-text.png, phone-editor.png. Produced by Flutter on physical Pixel 4 Android 16 through an attached synthetic-only fixture. Native RepaintBoundary image export captures the application viewport at 2x without OS notifications, keyboard or system bars; no browser, synthetic HTML or image editing. Current evidence is the standalone profile route; production HomeScreen now renders that same ProfileScreen directly for Wasifu and retains its existing bottom NavigationBar/expanded NavigationRail. Tablet delivery is not part of this verification; narrow 320dp +1.3 text is widget tested. Native large-text capture is 1.3 scale. Fixture never persists real credentials or calls backend. Normal APK target remains lib/main.dart.

Function evidence: seven profile tests pass (separate-service personal/medical edits, conflict retry/draft, owned offline advice, late response after account clear, 320dp large text, guarded request); six existing login/receipt regression tests pass. Analysis checks touched profile/API/session/navigation code. Writes verified via injectable repository, not real patient edits. Existing bill/receipt/security/privacy/family/health/insurance/feedback routes are linked without reimplementing their services.

Primary code: apps/patient-mobile/lib/screens/profile_screen.dart, profile_editor_screen.dart, saved_advice_screen.dart; lib/widgets/profile_card.dart; lib/core/profile_repository.dart; lib/screens/home_screen.dart (Wasifu branch), lib/core/session.dart and api.dart (identity guards). Preview fixture: integration_test/profile_preview.dart. No release provider or backend change requested.
