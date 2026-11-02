# Patient registration contract

Ordinary extension of the incumbent A-Health Android Material 3 app; preserve teal colours, existing themes, controls, and typography. Operate mode: finish first registration confidently, resume interruptions, and distinguish simulated payment from real payment. No new visual world or global design tokens.

Confirmed user flow: phone -> SMS OTP -> full name, DOB (confirmed instead of static age), sex, residence, verified phone, next-of-kin name/phone -> one-time TZS 4,000 registration -> password -> optional on-device face/fingerprint -> account. Existing active patients are grandfathered. User has no SMS/payment provider yet; local simulation must be visibly labelled and production must reject simulated payments.

Screens: phone/password login, OTP with resend/autofill, profile/contact, registration fee/pending, password, optional biometrics, locked screen, profile security entry. Native phone, dark mode and larger text are in scope. Portrait scrolling and keyboard clearance matter. Registration consent is separate from community consent. Next of kin gets no automatic access.

Security evidence is separate from visuals: restricted opaque enrollment capability, no normal session before verified payment, durable one-bill enrollment, server price, verified settlement, OTP attempt/replay controls, lockout, token rotation/revocation, password AMR preservation, local-only simulator.

Native screenshots are synthetic, captured by Flutter integration test on a physical Pixel 4 with current Dart sources after hot restart. All acceptance assertions passed. They do not prove physical face/fingerprint hardware enrollment or real SMS/mobile-money delivery. No web detector runs on native code. Judge the supplied captures and changed primary sources only; no rendering, edits, unrelated audits, or invented design system.

Primary files: apps/patient-mobile/lib/screens/{login_screen,verify_screen,registration_screen,security_screen}.dart and lib/main.dart. Preserve incumbent system during documenter handoff.
