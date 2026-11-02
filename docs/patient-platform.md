# Patient platform

This extends the existing Flutter patient app and staff console. It does not expose the clinician-only professional network to patients.

## Entry points

- Mobile **Huduma → Community ya afya**, **Pharmacy karibu nami**, **Elimu ya afya**, and **Fuatilia feedback**.
- Mobile **Ujumbe → Community na peer chats** and **Taarifa na ripoti zangu**. Existing consultation chats remain under the patient's visits.
- Clinician web: `/doctor/patient-community` and `/doctor/education`.
- Administrator web: `/admin/patient-platform` for pending posts, safety reports and feedback; create communities in the expandable section.
- API: `/patient-platform` is served by network (4017); web BFF and mobile direct-development routing include it. A deployed gateway must route this prefix to that service.

## Consent and privacy

Community participation has explicit, versioned consent, a user-selected alias, withdrawal, and account suspension checks. All posts and replies are held for moderation, including clinicians' contributions. Verified clinician badges are computed from current verification and account status. Community posts do not contain patient profile references. Staff clinical discussions use separate models and authorization.

Peer chat requires adult patient accounts with a recorded date of birth, explicit peer opt-in by both parties, membership in a shared active community, an invitation from an approved post, and recipient acceptance. Patients are not searchable through a directory. Declined invitations cannot be recreated to bypass rejection. Blocking closes the conversation. Leaving the last shared community or withdrawing consent removes access, including idempotent retries. Age checking uses recorded profile data; it is not an identity/age-verification service.

Peer writes and consent/block/moderation decisions share a transaction lock. Messages use a sender/request UUID uniqueness constraint. PostgreSQL transactional NOTIFY sends only an event pointer to the messaging WebSocket service; authorized clients refetch records. No peer message bodies travel in the event or notification preview. Reconnection refetches history. In-app notification history is owner-scoped.

Reporting discloses only the selected message/post and the reporter's reason to administrators, not the entire private conversation. Reports can be marked urgent and tracked by their submitter. Moderation decisions and administrative queue access enter the audit chain. Administrators can hide a reported public post and its replies or suspend its author. Published posts and safety reports remain after consent withdrawal; the consent screen states that retention behavior.

Existing patient–clinician chat now requires patient/guardian communication consent before new messages, checks current active participants and verified clinicians, and excludes general administrator browsing. Withdrawal stops new messages; the care record remains accessible to authorized treatment participants. The mobile chat explains this distinction. Consent changes and message writes are serialized per thread. Idempotency lookup runs after a fresh authorization check.

## Moderation, feedback and emergencies

New tracked feedback supports complaint/suggestion, account ownership, chronological status history, patient escalation and an administrator reply visible to the reporter. Escalated items sort ahead of ordinary items. The older anonymous incident workflow is retained separately; tracked feedback explicitly says it is linked to the account.

Community, peer chat and feedback are not continuously monitored emergency channels. Their emergency actions open the existing emergency request flow. Marking a moderation report or feedback urgent prioritizes its review; it does not dispatch an ambulance or promise emergency response. Assign operational moderation and governance coverage before production use. Queue pages process up to 100 open items at a time.

## Health education

Published article search accepts `q`. Structured disease guides store six sections: causes, symptoms, prevention, diagnosis, treatment and warning signs, plus source links and review metadata. Both the authoring form and patient detail support these fields. Drafts are excluded from public search. Only a currently verified, active clinician can publish. `/education/drafts` and the clinician review panel make unpublished drafts reviewable after a page reload.

`node scripts/seed-local-patient-platform.cjs` is restricted to the existing local database. It creates one empty moderated community, an education topic, and two unpublished Kiswahili guide drafts. It never adds patients, messages, inventory or a fabricated clinical reviewer. The drafts cover malaria and hypertension, using [WHO malaria](https://www.who.int/news-room/fact-sheets/detail/malaria) and [WHO hypertension](https://www.who.int/news-room/fact-sheets/detail/hypertension). Their clinical wording and localization still need a clinician's review and publication through the education workspace. Existing published articles are preserved.

## Pharmacy map and inventory

The Flutter map uses OpenStreetMap with attribution and an application user agent, following [flutter_map](https://docs.fleaflet.dev/) integration guidance. Location is requested only after the user chooses it and receives an explanation; a manual map point works without location permission. No background location tracking is used. The tile provider receives viewport tile requests. A fullscreen control expands the map within the screen. Marker details and a list remain alternatives for navigation.

Only active verified pharmacies participate. Unknown coordinates are never invented. Geographic filtering and sorting happen before paging; nearby queries cover a 15 km radius in the app. Medication results show availability only when quantitative stock and qualitative status agree and were reported within the last 24 hours. Older, missing, future-dated or inconsistent inventory is unknown. Out-of-stock entries are retained, timestamps are visible, and patients are asked to confirm with the pharmacy. Results are not a reservation or guarantee. Search currently computes distance over matching verified records in the service; introduce spatial indexing before materially increasing inventory volume.

## Verification and deployment boundary

Migration: `20261026233000_patient_platform`, including user/thread foreign keys.

Isolated database acceptance: `services/network/src/tests/patient-platform.test.ts` (10 cases) covers permissions, age/consent, pending-post isolation, peer acceptance and realtime delivery, blocks, withdrawal, shared-membership removal, reports, feedback ownership/history, stock freshness/distance, reviewed publishing and care-chat consent. The guarded runner `.local/patient-platform-db.cjs` uses a new local test schema.

Browser acceptance: `verification/patient-platform-browser.cjs` uses synthetic intercepted requests, temporary marked accounts that are suspended afterward, and no patient records or real messages. Native acceptance: `integration_test/patient_platform_acceptance_test.dart` uses synthetic API responses on Android; no clinical claims or stock in that harness are real. The production entry point remains `lib/main.dart`, not the acceptance harness.

Operational limits: configure HTTPS/WSS at the deployed gateway, provision actual moderator coverage, review/publish education content, and keep pharmacy inventory updated. Local tests do not certify iOS, production push delivery, emergency dispatch operations, or production load capacity.
