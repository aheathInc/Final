# AHP — real-service provider integration candidate (23 October 2026)

## Release classification

**ENGINEERING CANDIDATE — NOT APPROVED FOR PRODUCTION.** This changes real Auth, Payment, Gateway and Notification services, existing Next.js Staff Web and the actual Flutter Patient App. It does not introduce a second simulator, a SQLite substitute, or another operational database. Existing demos, if present in the baseline, are unchanged historical artifacts and must not be presented as these integrations.

Baseline archive: `A-Health-Handoff-Filtered-20261023.zip`; SHA-256 `a0a104b84798d7fecab1795d5aaca9ea345335ddaa73284f370a63d642972989`. Its reported Git source is `8a07a7acb3339b4e25c10432ad1dc39f24428f47`; this environment cannot independently fetch the user's current remote/worktree. A hash-checked installer will reject later conflicting changes.

No customer credentials were supplied, no provider or live bank/SMS requests were sent, no database migration was applied, and no Windows checkout, running service, Git history, commit, push or deployment was modified.

## Implemented behavior

### OTP and SMS
- Auth creates a random six-digit OTP, stores its bcrypt hash, and sends through the shared SMS transport. Concurrent request quotas serialize per phone; verification locks the challenge, counts invalid attempts, consumes successful codes once and creates the session in the same transaction.
- Sender failure invalidates the challenge and returns a safe error instead of pretending an SMS was sent. A delivery timeout is ambiguous; the person must request a new challenge. A delayed, invalidated code can arrive and must be rejected.
- Africa's Talking has a native form-encoded API adapter, bounded responses, recipient matching, timeout, redirect rejection and sanitized errors. Status 100/101/102 means accepted/queued/submitted, NEVER delivered to a handset. Delivery receipt callbacks are not part of this patch.
- Console mode is explicitly `simulated`. Production refuses console, HTTP bridge or sandbox SMS configuration. Existing local OTP echo requires the existing explicit development gate; plaintext OTP logging is disabled.
- Auth uses synchronous SMS dispatch; Notification uses its existing leased outbox. AT send timeouts can cause duplicate notification delivery on retry: this is at-least-once, not exactly-once handset delivery. OTP does not automatically retransmit. Provider latency/cost/rate-limit acceptance remains required.
- Notifications are generic and omit clinical payloads. Unprovisioned short codes and unsupported promises to reply with medication confirmations were removed from templates. Inbound SMS clinical writes are disabled by default and refused in production pending a durable, authenticated inbox.

### Bills, checkout and accounting
1. An active platform admin or the verified clinician assigned to a consultation issues one server-side bill. The staff-approved title and amount are immutable in this iteration. There is no patient-entered price and no automatic tariff catalog or family subscription bill.
2. The patient sees their server-issued bill in the Flutter **Bili zangu** screen, accessible from the existing insurance/payments screen, chooses M-Pesa, Mixx by Yas/Tigo Pesa, or Airtel Money, supplies their wallet number and (where required) email, and explicitly confirms initiation. The app never asks for a wallet PIN.
3. Payment Service reserves an intent before a provider call, under a bill lock. A retry or parallel initiation reuses the unresolved intent rather than creating a second debit. Lost/uncertain provider responses remain processing and are reconciled; they do not silently become failed/paid.
4. The Flutterwave adapter uses the documented v3 Tanzania charge and transaction verification endpoints, not fabricated carrier URLs. A v3 test key is required in test mode; live requires an explicit enable flag and live configuration. Neither configuration validation nor the presence of a key proves merchant/network eligibility.
5. Webhook authentication is selected explicitly. The default v3 `verif-hash` scheme performs constant-time secret comparison over TLS. Optional HMAC-SHA256/base64 validates exact raw bytes for accounts whose contract explicitly supplies that scheme. There is no automatic weaker fallback. V4 OAuth, payloads and charge endpoints are NOT implemented.
6. An authenticated callback triggers a server-to-provider lookup. Amount, currency, reference and transaction identity must match before settlement. Callback text and client buttons cannot settle a payment. A background reconciliation worker checks unresolved transactions even if callbacks are lost.
7. The receipt, intent status, bill status, audit and SMS outbox entry commit together. Idempotency and unique provider transaction identifiers prevent duplicate receipts/SMS rows; shared request caching cannot replay one account's response to another.
8. Historical payments remain `legacy`; they are not relabeled live/verified. Simulated and test receipts are labeled as such in the new UI. Cash/card instant-success is removed. Existing front-desk clearance remains manual and is NOT automatically changed by this payment patch.

Staff Web retains its existing design and routes. A bill form is integrated into consultation details; Admin Payments gains an actual bill list. Live-provider refund actions are explicitly unavailable rather than recording fictitious refunds. The existing console refund workflow remains non-production only. Actual refund/chargeback/dispute operations and financial reconciliation alerts are release blockers until an approved procedure exists.

Bills are limited to the latest 100 per authorized list. There is no billing-item reconciliation UI, bill amendment, void endpoint, tariff approval chain, tax invoice certification, installments, settlement-to-bank proof or family renewal in this candidate. A provider-verified collection is NOT a claim that the merchant's bank has received settlement. Payer email is required by the selected v3 integration; no invented email is supplied for feature-phone users. Agree an alternative provider or assisted payment route for patients without email before launch.

### USSD connected to existing services
The existing Gateway now calls actual Auth, Digital Front Desk, Doctor, Appointment and Payment APIs; it does not maintain parallel fake clinical/payment records.

- OTP consent and verification precede private account operations. Session context is encrypted with AES-256-GCM, bound to phone and session; production needs a separate encryption key. Callback duplicates return the stored response; action request keys stay stable.
- Gateway accepts a **trusted signed JSON bridge contract**, with timestamp and raw-body HMAC. This is NOT a ready direct telecom/aggregator callback or an allocated USSD shortcode. The bridge must authenticate the provider and map the verified MSISDN/session/text, rather than trusting a web user's asserted phone number.
- Menus offer region/facility, symptom text, existing department suggestions, currently receiving clinicians, physical pre-registration, current visits, published **voice** appointments, and payment of existing bills. Lists paginate three items; up to 100 upstream results are supported. Date/slot display uses Dar es Salaam time.
- Physical pre-registration returns an existing front-desk visit ticket, not a fabricated accepted consultation. The original hospital review/check-in/clinician-start process creates the consultation as before. A voice appointment is a booking, not a completed call. There is no physical slot modality in the baseline schema, so future physical slots are not fabricated.
- Urgency is self-declared with a human-care diversion; the menu is not clinically validated AI triage. Queue time is explicitly unavailable rather than invented. Clinical routing remains the existing department navigation.
- This does NOT implement the whole requested Unified Get Care, online video/voice calling, family management, or clinical-message reading over USSD. Existing SMS-phone identity alone does not authenticate private writes. Clinical SMS reply processing is disabled.
- USSD calls hold a per-session database transaction with a 20-second bound and 5-second upstream request timeouts. Carrier session/character limits, latency/concurrency/load, duplicate recovery and long medical-text handling must be validated. A process crash after OTP verification but before context commit can require a new session; no OTP bypass is introduced.
- The existing session row retains its phone number; context encryption is not full-database anonymization. Configure database encryption, retention/cleanup, access controls and key rotation before deployment. No retention worker was added.

## Schema and compatibility

Migration **23**: `20261023190000_verified_payment_bills`. It adds `care_bills`, associated foreign keys and indexes, and provider/environment metadata on payment intents/receipts. All 22 baseline migrations remain byte-identical. No rows are deleted or recreated. Partial SQL uniqueness limits each bill to one unresolved intent. Prisma validation and drift verification remain NOT RUN here.

**Breaking API correction:** POST `/payments/intents` now requires `bill_id`, `method=mobile_money`, provider and payer phone; arbitrary client amount/currency/purpose and cash/card are rejected. Coordinate all client deployments. Old API consumers must not be allowed to bypass this correction. Changed shared token AMR and idempotency behavior require cross-service regression.

The canonical contract is `packages/api/openapi/a-health-api-v1.yaml`. Related declaration changes were targeted by hand; pinned `openapi-typescript` generation has NOT run. Before merge, regenerate and verify its full output. The legacy root YAML is not the canonical contract and was not updated as an authority.

## Verification performed here

- New real-source/injected-dependency suite: **88/88 PASS** (OTP, SMS, provider adapter, signature handlers, billing/settlement, USSD and ownership/idempotency). These use mocked transport and serial transactional database doubles. They do NOT validate real SQL locking/rollbacks, Express/JWT over HTTP, or external provider behavior. Bcrypt orchestration uses a double; bcrypt strength is not tested by those tests.
- Existing database-free verification suite: **308/308 PASS** after fixing a stale follow-up test harness. The first run had seven failures: the test stub omitted the shared safety module and current required schema/identity fixtures. The correction preserves the stricter guard and adds sanitized connection-error handling and literal database-path validation; it does not relax allowed database targets.
- Strict TypeScript semantic check: four dependency-free implementation modules PASS. API declaration standalone type check without skipping declarations PASS. Whole-repository TS/TSX parser check is syntax-only, NOT a complete project type check.
- Written but NOT RUN: 14 real PostgreSQL payment tests; gateway database-backed tests; five Flutter payment widget tests. The Flutter tests deliberately disable decorative continuous motion so workflow settling can complete.
- NOT RUN: real Postgres migration/drift, locked backend/Next.js build, Flutter analyzer/build/widget execution, browser/device acceptance, provider sandbox/live, handset/USSD and load/security testing.
- Environment: Node 22.16/global TypeScript available; project dependencies, Prisma, PostgreSQL and Flutter unavailable. Package registry DNS failed. Tool availability limits verification, not the disclosed implementation scope.

## Required staging and release gates — all remain mandatory

1. Securely back up the intended non-production database; verify target/owner/port and explicit test schema. Never use port 5432 or reset an existing schema. Do not run the old launcher until deployment plan reviewed: it can deploy pending migrations automatically.
2. Apply the update by baseline hashes only; compare conflicts against the latest Codex work. Preserve real env files. Restart only owned application processes in a controlled maintenance window.
3. Use the locked package versions. Generate Prisma, validate, apply migration ONLY to the approved staging target; confirm expected 23 migrations and no drift. Run the full backend/auth/notification/gateway suite on newly approved isolated schemas; no real patient/financial data.
4. Regenerate canonical OpenAPI declarations, semantic-lint, run full Staff Web type-check/build, full Flutter analyze/tests/debug/release, and authenticated browser/device journey tests. Compare all clinical regression results and original patient-account isolation checks.
5. Establish approved AT sender and Flutterwave Tanzania merchant/network capabilities. Keep real credentials in the deployment's secret manager, not examples, ZIPs, terminal command arguments, chat or Git. Test fail-closed production configuration, key rotation and exception logging.
6. Test native provider sandbox request/confirmation/denial/timeout, invalid signature, wrong amount/currency/reference, replay, duplicate callback, callback-before-response and lost-callback reconciliation. Test handset delivery separately; implement authenticated DLR tracking before claiming delivery.
7. Provision and authenticate the USSD provider bridge/shortcode. Test on a feature phone, session expiry, paging, Unicode/length, OTP arrival while session active, latency, resuming failures and privacy. Never invent a shortcode or a callback signing mechanism the provider does not implement.
8. Operational sign-off: TLS, secrets/DB encryption, centralized logs without PHI, rate limiting/WAF, monitoring/alerts, durable support reconciliation workflow, refund/dispute process, user support, consent/data retention and regulatory/governance review. End-to-end evidence is needed, not just health checks.
9. Enable live only with owner/provider approval and controlled test amounts/numbers. No real charges/messages were authorized or sent here. The install script does not activate providers, migrate, start, commit or push.

## Pending broader requirements — NOT completed by this delivery

OTP-first demographic onboarding, password/PIN/biometrics; full Unified Get Care/all modes and hospital interoperability; paid family Basic/Upper/Premium entitlement lifecycle; free governed researcher onboarding/ERB/OMOP/eCRF; live calling/video; provider-native DLR and inbound clinical SMS; complete tariff/finance/refund operations. The existing premium navigation/brand and unrelated clinical functionality are preserved rather than rewritten.

## References consulted (primary provider documentation, retrieved 23 October 2026)

- Flutterwave v3 Tanzania mobile money: https://developer.flutterwave.com/reference/charge-via-tanzania-mobile-money
- Flutterwave v3 webhook authentication and re-query requirements: https://developer.flutterwave.com/v3.0/docs/webhooks
- Flutterwave v4 HMAC reference (optional scheme only, NOT a v4 charge integration): https://developer.flutterwave.com/v4.0/docs/webhooks
- Africa's Talking accepted versus delivered/status codes: https://help.africastalking.com/en/articles/16150386-messaging-error-codes

No regulatory compliance certification, penetration-test certification or clinical/financial production approval is claimed.
