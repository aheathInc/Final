# Login and receipts refinement

Ordinary incumbent Flutter Android refinement, Operate mode. Preserve the existing Material/teal theme, controls and surrounding registration flow. User requests biometrics, login without retyping the phone and downloadable payment receipts.

Known account: password entry without a phone input; remember only a previously verified patient identity in secure storage. New device/account switching still identifies the patient. Never store a password. Keep OTP recovery and an explicit forget/switch action.

Biometrics: visible Profile entry and Security controls above password changes. Enroll through OS settings, recheck on return, enable only after successful biometric-only authentication. Keep password fallback. Distinguish hardware capability/enrollment from app opt-in and real authentication. User said they will enroll Face Unlock; do not claim hardware success until it actually succeeds.

Receipts: download button at paid registration and settled bill history. PDF attachment from authorized server records only; pending requests get no receipt, other patients cannot access it, partial/full refunds remain visible. Prominent simulation banner. Android save picker with truthful success/cancel/failure feedback. No clinical details. A synthetic PDF has been rendered/inspected separately.

Primary files: apps/patient-mobile/lib/screens/login_screen.dart, security_screen.dart, profile_screen.dart, payment_bills_screen.dart; lib/widgets/biometric_settings.dart and receipt_download.dart; lib/core/session.dart and api.dart. Native evidence lives in native/ (Pixel 4 current source, synthetic API/secure-storage fixtures). PDF preview .local/receipt-review/receipt-sample.png. No web detector or new-world comp. Missing global PRODUCT/DESIGN is pre-existing; SKILL.md incumbent-refinement routing exception applies. No broad audits, invented design files, edits or new rendering during finish review.
