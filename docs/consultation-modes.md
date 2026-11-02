# Consultation modes

Patients explicitly select a mode when submitting a request:

| Mode | Destination/channel | Consultation fee (TZS) |
| --- | --- | --- |
| Hospital | Selected active hospital/clinic; attend in person | 0 |
| Remote, general practice | Video, audio, or live chat | 5,000 |
| Remote, specialist | Video, audio, or live chat | 8,000 |

The server validates the mode and destination, scopes hospital offers to that facility, and retains a selected doctor across retries. Hospital requests cannot create or pay a consultation-fee bill. Other clinical charges are separate.

New remote requests use `remote-tzs-v1`. The quoted amount is frozen when a doctor is selected, or determined from the accepting doctor's specialty when matching automatically. Acceptance creates one consultation bill transactionally. It does not debit the wallet automatically. Existing remote requests keep their historical billing behavior. The migration backfills hospital requests linked to front-desk visits without deleting financial history.

## API

Authenticated `GET /consultations/options` supplies active facilities, modes, remote channels, and fees. Create with `POST /consultations` and an `Idempotency-Key`:

```json
{"channel":"app","consultation_mode":"hospital","facility_id":"<facility UUID>","modality":"in_person","symptom_text":"..."}
```

```json
{"channel":"app","consultation_mode":"remote","modality":"video","clinician_id":"<optional clinician UUID>","symptom_text":"..."}
```

Remote channels are `video`, `voice`, and `chat`. Clients should always send the mode; older clients omitting it default to remote and still receive the current fee policy. Responses include `consultation_mode`, `facility_id`, `facility_name`, `consultation_fee_amount`, `consultation_fee_currency`, `consultation_fee_required`, and `consultation_fee_policy`.

## Calling and live chat

The patient can find **Jiunge na video call** (or the audio equivalent) on an ongoing consultation card on Home and in its consultation details. While the request is pending/offered/escalated, the same button stays visible but disabled with an explanation that the doctor must accept first. It becomes usable for matched/in-progress remote audio/video consultations. Hospital, chat-only, completed and cancelled consultations do not offer this call action.

Only the assigned verified doctor can initiate a call during an accepted remote audio/video consultation. This is enforced by the server, including requests made outside the UI. The patient/guardian opens the call room and waits for the doctor, then explicitly selects **Pokea call** or declines. Entering the room alone does not enable the patient's camera or microphone. Camera and microphone tracks stop when leaving or ending the call. No call recording is implemented.

The meeting layout keeps the other participant on a large stage, the user's own video in a small corner preview, and microphone, camera and hangup controls below. Both the doctor's web room and the patient video screen offer optional fullscreen without recreating the media connection. Android Back exits fullscreen first; leaving the room ends the call. System navigation bars remain subject to Android's edge-to-edge rules. This uses the application's WebRTC implementation, not a Google Meet integration.

Signalling uses authenticated HTTPS endpoints under `/consultations/:consultation_id/call`:

- `GET`: ICE configuration, `can_start`, and the active offer/answer, scoped to the participant.
- `POST /offer`: assigned doctor only; `{ "call_id": "<client UUID>", "sdp": "<complete offer SDP>" }`. Patient attempts return `CALL_DOCTOR_ONLY`.
- `POST /:call_id/answer`: `{ "sdp": "<complete answer SDP>" }`.
- `POST /:call_id/end`: ends the call and clears SDP.

Offer retries reuse the call UUID. Only one active call is allowed. Unanswered offers expire after two minutes; answered sessions after two hours. End, consultation completion, and expiry clear SDP. Signalling deliberately bypasses the general idempotency-response cache. Do not log SDP, tokens, or relay credentials.

Live chat uses the existing single-use realtime ticket and WebSocket channel, refetching persisted messages on thread events. Polling remains a fallback on interrupted connections.

## Deployment

Configure the consultation service with your TURN deployment:

```dotenv
WEBRTC_STUN_URLS=stun:turn.example.org:3478
WEBRTC_TURN_URLS=turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349?transport=tcp
WEBRTC_TURN_SECRET=<shared TURN REST authentication secret>
```

The server returns temporary HMAC credentials (three-hour validity); keep the shared secret server-side. Configure the TURN server for matching REST shared-secret authentication, valid TLS certificates, and reachable relay ports. Set the advertised addresses correctly for its network. Use HTTPS for browser camera/microphone access and WSS for the existing realtime service in production.

With `NODE_ENV=production`, calling is unavailable until TURN URLs and the secret are configured. Development permits local peer-to-peer calls without a relay. USB `adb reverse` forwards API/signalling ports; it does not relay WebRTC media. A phone and computer need a reachable local network or TURN for media. Test both directions, audio/video, permission denial, hangup, and different mobile/Wi-Fi networks before deployment. No external TURN server is provisioned by this change.

## Validation

For repeatable local acceptance, first start the normal local stack, then run `node verification/consultation-live.cjs` to create isolated synthetic accounts/consultations in the local development database. It refuses non-local database targets. The generated `.local/consultation-live.json` contains identifiers only. Run `node verification/consultation-browser.cjs --skip-capture` for browser media/chat checks.

For physical Android acceptance, start `node verification/consultation-phone-peer.cjs` and (for screenshots) `node verification/consultation-captures.cjs` in separate terminals. Forward API ports 4001–4025 and helper ports 4040/4041 with `adb -s <device> reverse tcp:<port> tcp:<port>`. Then, from `apps/patient-mobile`, run:

```powershell
flutter test integration_test/consultation_acceptance_live_test.dart -d <device> --dart-define=API_HOST=127.0.0.1 --dart-define=DARK_MODE_REVIEW=true --dart-define=EXPORT_MODE_SCREENSHOTS=true --no-pub --reporter expanded
```

Grant the isolated debug app camera/microphone permission when requested. The phone test uses real camera/microphone tracks, with a synthetic browser peer; it never records or persists media. Form screenshots contain synthetic data only. The browser peer must be allowed to reach the phone over LAN: a sandbox that permits localhost signalling but blocks LAN UDP will make ICE fail. Stop both helper processes afterward. The media test needs a reachable peer network or TURN; API forwarding alone is insufficient. Reinstall the normal debug APK after integration tests.

For a prebuilt device-specific test APK, build with `flutter build apk --debug --no-pub --target-platform android-arm64 --split-per-abi --target integration_test/consultation_call_live_test.dart` plus the same Dart defines above, then use `flutter drive --driver test_driver/integration_test.dart --use-application-binary <test.apk> -d <device> --no-pub`. Prefer this workflow on a shared development phone: `flutter test -d` can uninstall the debug app and delete its saved login. Keep the normal application APK separate from this test binary and reinstall it with `adb install -r -t` afterward. The call test verifies doctor initiation, patient answering, bidirectional media, mute, fullscreen entry/exit and confirmed hangup. Active-call screenshots disable the phone camera before capture.

Backend regression tests cover mode validation, facility routing, zero hospital fees, fixed remote fees, duplicate acceptance, legacy-client pricing, participant authorization, call retries, and SDP cleanup. Flutter tests cover selection and request payloads. Local browser acceptance uses synthetic media and synthetic accounts, while the Android integration test exercises the actual USB-connected device and live API. Test artifacts contain no real patient media.

Local acceptance on 25 October 2026:

- Consultation engine/mode tests: 24 passed; payment regression tests: 14 passed.
- Flutter form/repository tests: 13 passed. Physical Pixel 4 mode selection and live requests passed.
- Browser-to-browser video and audio exchanged RTP with synthetic media; mute, end, and both chat directions passed.
- TypeScript checks and scoped Flutter analysis passed. API types regenerated; unrelated pre-existing OpenAPI warnings remain.
- Physical Pixel 4 and browser peer passed video/audio media exchange in both directions, microphone mute, and server-confirmed hangup on the shared hotspot, with USB used for installation and API forwarding. The combined form/call acceptance run passed. Earlier ICE attempts failed while the browser peer ran inside a network-restricted sandbox; the final peer ran outside that sandbox.
- Physical light/dark screenshots passed the scoped UI review after correcting new secondary-text colors. Existing unrelated dark-theme debt is outside this change.
- Production TURN and cross-network call acceptance remain outstanding deployment work. No external relay has been provisioned.

Doctor-initiated calling update, 26 October 2026:

- Server regression coverage verifies patient offers are rejected and `can_start` is doctor-only; 24 consultation and 14 payment tests passed.
- Seven patient entry-action tests passed, including pending/accepted requests and non-call modes. Scoped Flutter analysis and web type checks passed.
- Browser acceptance passed doctor-initiated video/audio, fullscreen entry/exit, mute, hangup and both chat directions. One earlier audio ICE attempt failed; the subsequent complete run passed.
- USB-connected Pixel 4 acceptance passed patient answering, bidirectional video/audio RTP, mute, front/back camera switching with matching preview mirroring, camera-off, fullscreen entry/exit and server-confirmed hangup on the shared network. This full run completed in 32 seconds. A subsequent spacing-only correction added 8dp between Accept and Decline; its separate incoming-screen capture/decline run passed in 11 seconds. The normal debug application is installed with data preserved.
- Visual coverage is Pixel 4 portrait at default font scale and web at 1440/390px plus fullscreen. Native landscape and font scale 1.3 remain unverified.
