# Patient Messages tab

`Ujumbe` opens `MessagesScreen` directly inside Home, using its own app bar while retaining Home's five-destination navigation bar/rail. The inbox lists care threads rather than repeated consultation visits. It retains the existing community, peer chat, notifications/reports, consultation creation and emergency destinations; it introduces no patient directory or unrestricted peer messaging.

## Inbox behavior

`GET /care-threads` loads 25 conversations per page. Rows show the supplied clinician name (or `Timu ya matibabu`), consultation reason, latest-message preview, local time/date and incoming unread count. Closed conversations have an explicit read-only label. A message without text is represented as an attachment; a thread without messages says so. No availability dots or response-time promises are added.

Search matches clinician name and reason, case-insensitively, within loaded pages. `Yote` / `Hayajasomwa` also filters only loaded pages. `Pakia mazungumzo zaidi` follows the server cursor and deduplicates by thread ID. Refresh replaces the list with the first page. Quiet refresh runs every 20 seconds while the route is current, the app is foregrounded and the session is unlocked; resume and return from a thread also request a quiet refresh. Quiet refresh skips lists larger than 25 entries to preserve manually loaded pages; use explicit refresh to update those lists.

Loading, failed loading and an empty result are distinct. A refresh failure keeps existing rows with a stale-data notice and retry. Empty search/unread results refer to the current list; a genuinely empty unfiltered inbox offers the existing new-consultation flow. The screen states that messaging is not continuously monitored or an emergency service, with access to existing emergency help.

## Data and read acknowledgements

The backend inbox projection retains its caller visibility filter, adds the latest message (body truncated to 180 characters) and counts messages with a different sender from the caller and no `readAt`. It does not infer unread state from thread status. The badge displays up to `99+`, with the actual count in its semantic label.

Opening a row passes its care-thread ID to the existing `ThreadScreen`. Existing conversation realtime updates, polling, consent and sending behavior remain. Conversation history follows message cursors rather than stopping at the first page. After loading, the thread uses the existing authorized `POST /care-threads/{id}/messages/read` endpoint up to the latest loaded unread incoming message. It only requests acknowledgement when the route is current, the app is foregrounded, the session is unlocked, and the owner still matches. A failed acknowledgement does not optimistically clear unread state.

Inbox generation/session checks reject late results after an account change and clear old rows/search. The thread clears messages and drafts, disables sending and rejects stale loads when identity changes. These are client protections alongside server authorization.

## Design and evidence

Existing patient `PRODUCT.md`, `DESIGN.md` and `AppPalette` remain authoritative. The two secondary shortcuts reuse `ProfileCard` gradients and diffuse shadows; conversation rows stay flat with Material icons, controls and readable light/dark colors. Content is bounded to 720 dp and scrolls; filter chips wrap. No global design tokens changed.

Four physical Pixel 4 synthetic native fixture renders in `.impeccable/review/messages/` cover light, dark, large text and empty states. They export the Flutter application boundary at 2x and exclude OS bars, keyboard and production Home navigation. They do not establish full-device insets, tablet/landscape behavior or native live chat acceptance. No actual message was sent during this task.

The parent confirmed 25 initial Flutter regressions passing and the final focused nine message tests passing after the lifecycle/read guard changes. Targeted Dart analysis found no issues; backend TypeScript build and one Prisma-stub inbox query/serialization test passed. A read-only projection smoke check against local PostgreSQL also passed using existing records, without outputting identifiers/content or writing messages. The consultation service health check returned 200.

The fresh visual reviewer recorded `ship` with no material fixes. The normal APK from current sources was built with version code 2010 and installed on Pixel 4 with strict `adb install -r: Success`; normal cold launch and installed version were confirmed. Final results are recorded in `.impeccable/review/messages/verification.json`. Installation and database checks are separate evidence from the synthetic renders; no live send/receive acceptance is claimed.
