# Consultation billing, digital referrals and professional groups

Implemented in the unified staff application (`http://localhost:3000`) and the network, consultation and payment services. Apply migration `20261026150000_referral_network_threads` and regenerate Prisma before starting these services.

## Consultation charges

- Hospital consultation is free. Remote consultation remains TZS 5,000 for general practice and TZS 8,000 for a specialist, as agreed.
- A consultation whose recorded fee is zero is also free, regardless of mode. Acceptance does not issue a bill for it. Manual consultation billing and checkout reject it, including a historical unpaid bill.
- Bill lists expose `payable` and `payment_block_reason`. The patient app hides payment selection for blocked bills. Financial history remains intact; this change does not silently delete paid bills or claim to reverse money already collected.
- Tests and medicines are separate charges. The facility must disclose each item's price and obtain patient approval before payment. They must not be charged as a consultation fee for a free service. The consultation request screen explains this distinction; this change does not invent a laboratory or medicine price catalogue.

## Digital referrals

Open **Referrals** in the doctor workspace. Each record includes a patient profile reference, referring clinician and original facility/department, destination facility/department and optional named clinician, clinical reason, urgency, medical summary, status, timestamps and outcome feedback. Unknown department assignments remain unset.

The form exposes **Destination hospital / facility** as a searchable directory of registered active hospitals and clinics, independently of patient consent. It loads all directory pages, displays departments for the chosen facility, and shows consent status separately. After the patient grants exact-case facility consent, **Refresh patient consent** updates that check without erasing the clinical draft. Sending remains blocked until a matching authorization is available. Directory failures provide a retry instead of looking like an empty hospital list.

The clinician reviews the minimum necessary summary before submission. Patient consent must name the exact destination facility and care thread. Submission, receipt, acceptance, start of care and completion remain distinct transitions. The original source facility is read from the referral snapshot, even if the clinician subsequently transfers.

**Secure clinician handoff** appears after submission. Only the referring clinician and currently eligible destination clinicians can read or send messages. Every operation rechecks the clinician's active role/verification, facility assignment and current consent. Consent withdrawal/expiry closes access, including retried sends. Completed or declined conversations are read-only while consent remains valid. Draft, cancelled and expired referrals have no accessible conversation. Patients receive their existing referral status/outcome view; this channel is for clinicians.

Messages use a per-sender `client_message_id` UUID to deduplicate retries after fresh authorization checks. Audit entries record message IDs, not message text. Clinical reason, patient reference, summary and decline reason are redacted from clinician referral responses when consent is unavailable. Production transport must use the deployment's HTTPS gateway; localhost HTTP is development-only. Message refresh is explicit; this is not an emergency dispatch channel.

## Professional groups

Open **Professional network** (`/doctor/network`). Active verified clinicians can browse available groups, join/leave, select a group feed and publish a discussion. Group content requires current membership. Discussion authors must omit patient identifiers from free text; the system does not promise automatic text de-identification. Patient-case handoffs belong in consent-scoped referrals, not professional groups.

For an empty local development catalogue, `pnpm seed:local:network` provisions **AHP Clinical Forum**. It is restricted to the local development database, leaves an existing active catalogue unchanged, does not reactivate a deliberately closed starter group, and creates no memberships or messages. The forum is open to verified clinicians across specialties; its general-practice category does not restrict membership.

Replies can address the discussion itself or a specific reply. The parent must belong to the same discussion; service validation and a database foreign key enforce this. Thread depth is bounded to eight levels, with indentation capped on small displays. Replies are paginated in chronological order, and the UI supports loading additional pages. Existing replies remain root replies.

Notification preferences are per group:

- **Replies in discussions I follow** (default): replies to discussions the clinician authored or has replied to.
- **All group activity**: new discussions and replies.
- **Muted**: no new notifications.

Notifications are persisted in AHP, omit the message body, exclude the actor, and are created atomically with the post/reply. Only their recipient can read or mark them read. Leaving a group removes its notifications. The network page refreshes notifications every 30 seconds while visible, and also provides manual refresh. No unsolicited email or SMS group broadcasts are added.

## Validation

Service tests use isolated PostgreSQL schemas and console payment adapters. They cover free consultation billing and legacy checkout, unchanged remote prices, referral consent withdrawal and retry protection, unauthorized readers, nested reply isolation, notification ownership/preferences, and existing collaboration/referral transitions. Browser acceptance uses clearly marked synthetic responses without posting to real clinical groups. Its fixture account is suspended after the run. Mobile widget tests cover free-bill payment suppression and existing payment/consultation request flows.

Browser captures and finish review: `.impeccable/review/professional-network/`. UI scope is the unified staff web application; the separate legacy doctor-admin frontend does not expose the new threaded composer. API clients must join a group before reading or posting.

Acceptance completed on 2026-10-26:

- 20 network/referral/collaboration tests, 15 billing regression tests and 10 consultation-mode tests passed in isolated schemas. The additional orphan-bill test passed separately; the referral handoff test was rerun with completed-conversation and consent-withdrawal checks and passed.
- Six payment widget tests and four consultation-mode widget tests passed. Android debug APK built with `API_HOST=127.0.0.1` for USB port reversal. No device was listed by ADB, so this APK was not installed or exercised on a physical phone in this task. Scoped Flutter analysis reported 11 existing informational style/deprecation findings, no compile errors.
- Network, payment, consultation and staff-web TypeScript checks passed. OpenAPI generation succeeded; existing unrelated OpenAPI warnings remain.
- Browser acceptance passed joining, notification preferences/read ownership UI, group posting, nested replies, referral handoff, posting before loading older pages, empty/error recovery, and desktop/mobile overflow checks. Nine synthetic-data screenshots were captured. No real group messages were posted by acceptance tests.
- Impeccable review disposition: **ship** at the three-fix verdict scope (chronology, error-state truth, fixture counts all resolved). The separate documenter found no new system drift and preserved the incumbent design files.
- Local auth, consultation, payment, network health endpoints and staff login returned HTTP 200. The local database migration is applied, and AHP Clinical Forum is available for voluntary joining.
