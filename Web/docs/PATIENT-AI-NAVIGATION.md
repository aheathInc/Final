# Patient AI Navigation / Assistant

## Provider and contract

**AI PROVIDER — LOCAL/STUB.** The AI service defaults to `CHAT_PROVIDER=stub` in development. It uses deterministic phrase rules for the navigation examples and configured emergency phrases. It makes no external model request and needs no paid or external API credential. The service also has an `openai_compatible` adapter, but this milestone does not select or validate that provider and does not claim production AI intelligence.

The Patient app uses the existing authenticated API:

- `POST /ai/conversations` opens a patient-audience conversation.
- `POST /ai/conversations/{conversation_id}/messages` returns the assistant reply and optional `navigation_action`.
- `GET /ai/conversations/{conversation_id}` is the existing owner-protected conversation read API.

All AI routes require a bearer token. A conversation belongs to the authenticated `userId`; another patient cannot read or send messages to it. The Patient app creates conversations with `audience: patient` and does not attach a patient profile, care-thread, or dependant identifier.

## Context and persistence

The navigation flow does not query patient profiles, consultations, appointments, prescriptions, test results, consent, or family records. The AI service sends its configured system instruction, up to 20 earlier turns from the same conversation, and the current user message to the selected adapter. It does not receive passwords, tokens, OTPs, admin notes, clinician-only notes, or another patient's records from this flow.

Conversation and message text are persisted by the existing AI backend. The Patient screen holds the active conversation and visible messages in memory while open; it does not show a conversation-history list or resume a previous conversation after closing. Navigation metadata is returned on the message response and is not stored in the existing message table, so a later `GET` does not restore its action button.

## Allowed navigation actions

Only these fixed codes map to existing Patient screens:

| Action | Existing destination |
|---|---|
| `OPEN_DOCTORS` | Doctor directory |
| `START_CONSULTATION` | Existing new-consultation flow; patient reviews and submits it |
| `OPEN_APPOINTMENTS` | Appointments |
| `OPEN_DIAGNOSTICS` | Diagnostics and results |
| `OPEN_MEDICATIONS` | Prescriptions and medicines |
| `OPEN_PHARMACY` | Existing medicine/pharmacy availability screen |
| `OPEN_FAMILY` | Family and dependants |
| `OPEN_EDUCATION` | Health education |
| `OPEN_PREVENTION` | Screening and prevention |
| `OPEN_EMERGENCY` | Emergency/SOS form |
| `OPEN_PRIVACY` | Consent and privacy |
| `OPEN_FEEDBACK` | Feedback and complaints |
| `OPEN_INSURANCE_PAYMENTS` | Insurance and payment records |

The app maps codes with a closed Dart enum and a fixed switch. It never derives a route, URL, command, or privileged action from assistant text. Unknown metadata displays an unsupported-action notice and opens nothing. The local stub has one `UNSUPPORTED_TEST_ACTION` sentinel solely to verify this rejection path.

Navigation buttons require an explicit patient tap. `START_CONSULTATION` only opens the existing form; it does not submit a consultation. Emergency escalation only opens the Emergency/SOS form; it does not submit a request, dispatch an ambulance, notify a responder, or provide an ETA. Dispatch remains local/simulated.

## Clinical safety boundary

**NOT A DIAGNOSTIC OR PRESCRIBING SYSTEM.** The assistant is identified in the UI as a local stub, not a clinician. It does not diagnose, prescribe, change medication, interpret test results, provide treatment plans, or advise a patient to ignore clinician instructions. Symptom-related navigation points to existing consultation/appointment flows. A configured red-flag phrase produces an urgent-care message and an explicit Emergency/SOS button.

Assistant text is rendered as plain text. It is never parsed as a route or executable instruction. The provider's optional structured action is still treated as untrusted and checked against the app allowlist. Payment, consent, admin, clinician, and emergency submission operations are not AI actions.

## Verification

- AI service tests cover deterministic appointment/consultation/medication/diagnostics/privacy suggestions, emergency escalation, the unsupported test sentinel, prompt-injection text, route authentication, conversation ownership, typed action response, and minimum model context.
- Patient Flutter tests cover reply parsing, unsupported-action rejection, fixed destination mapping, patient/assistant message distinction, and safe retry/error state.
- `Mobile app/patient_app/integration_test/patient_ai_navigation_live_test.dart` exercises the actual Flutter `Api` and `PatientAiRepository` against the local services. It creates two synthetic patients through the development OTP endpoint, checks unauthenticated rejection, all navigation responses and existing destination widgets, then confirms Patient B cannot read Patient A's conversation. It requires development Auth with `OTP_ECHO_IN_RESPONSE=true`, the AI service, and network routing from the test device to those local ports. OTPs and session tokens stay in process memory and are not printed.
- For an Android device connected by ADB, reverse the app's local API ports to the local Auth, Patient, and AI service ports, then run `flutter test --no-pub integration_test/patient_ai_navigation_live_test.dart -d <device-id> --dart-define=API_HOST=127.0.0.1` from `Mobile app/patient_app`. Remove the temporary ADB reverse mappings after the run.
- Run Flutter tests with `flutter test --no-pub` from `Mobile app/patient_app` and AI service tests/build with the existing Web workspace scripts against the isolated `ahealth_test` database when tests require database writes.

## Limitations

The local provider is phrase-matched and will miss or misunderstand requests outside its fixtures. It is not clinical intelligence and has no validated medical knowledge source. No patient record context is retrieved. Previous messages are persisted in the existing AI tables, but the app does not provide durable history navigation. The message action is not persisted. A non-stub provider's generated text is not parsed into navigation actions by this implementation.

## Local synthetic account cleanup

**LOCAL SYNTHETIC ACCOUNT CLEANUP REQUIRED.** During local acceptance, 11 synthetic OTP-verified Patient accounts were created through the Auth service on port 4001 in `localhost:55432/ahealth_dev`. That database is backed by the persistent `roadguard-local` Docker volume, and its ownership/disposable status is uncertain. Leave these records untouched; the database owner must inspect them and use that environment's established cleanup procedure. No account credentials, OTPs, tokens, or patient details are included in this repository.
