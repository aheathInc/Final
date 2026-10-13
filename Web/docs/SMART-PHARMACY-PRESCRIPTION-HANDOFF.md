# Smart Pharmacy and Prescription Handoff (Phase C)

## Scope and status

This phase extends the existing Pharmacy microservice, unified Staff Web, Consultation prescription records, and Patient Flutter medication screen. It does not create another application or another Pharmacy service.

Implementation branch: `feat/smart-pharmacy-prescription-handoff`, based on `456f1d0a`.

The backend workflow is covered by isolated database-backed tests. Staff Web type-check and production build pass. Live Firefox pharmacist acceptance and authenticated Patient A/Patient B API checks have been exercised against an isolated local `ahealth_dev`. Session-gated Flutter widget assertions rendered Patient A's authenticated completed-prescription read-back and Patient B's authenticated empty list. A deterministic Flutter A-to-B session/cache transition regression now passes using synthetic authorized API responses and the real `Session.clear`/`Session.save` lifecycle. Live OTP-driven in-app switching and physical-device acceptance were not exercised; server-side ownership isolation is verified. See [Acceptance evidence](#acceptance-evidence).

## Architecture and data

- Consultation remains the source for clinician-authored prescriptions and signed consultation notes. When prescribing, the clinician must supply a positive quantity for every item and a validity date. The date is stored as the end of the selected day in UTC.
- Pharmacy owns availability search, handoff references, pharmacist membership checks, dispensing records, and fulfilment read-back.
- PostgreSQL adds optional `Prescription.valid_until`, optional per-item `quantity_prescribed`, optional pharmacy-to-facility linkage, confirmed `quantity_on_hand`, revocation and dispensing references, and pharmacist memberships. The additive migration is `20261013100000_smart_pharmacy_prescription_handoff`; it does not rewrite historical prescriptions or remove inventory.
- Old prescriptions without a clinician-supplied validity date or quantities remain readable but fail closed for dispensing. Their read-back reports unspecified quantities and unknown facility coverage; it never labels a null quantity as zero or complete.

## Eligibility and authorization

A handoff can be issued only by the patient, their authorized guardian, or the prescribing clinician. The service requires an active prescription, a future clinician-supplied validity date, a completed consultation, a signed note from the same prescriber, an active verified prescriber, and a positive prescribed quantity for every item. Discontinued, completed, expired, unsigned, unquantified, or otherwise ineligible prescriptions cannot be dispensed.

A dispensing write requires an active `pharmacist` account and an active, verified membership for the specific active, verified pharmacy. Membership records require a professional-license identifier and verification metadata. Doctor, patient, and platform-admin roles do not inherit dispensing privileges. There is no public self-enrollment or membership-verification workflow yet; real dispensing remains closed until the organization defines and operates a professional-license verification/provisioning policy.

## Facility stock and pharmacy discovery

Patient fulfilment read-back checks the verified active pharmacy linked to the prescriber's facility first, when one exists. It reports item-level available, partially available, unavailable, or unknown status from actual stock rows and remaining prescribed quantities.

Medication search uses the existing Pharmacy service and actual stock records. It can filter by supplied coordinates and radius and compare a requested quantity. Patient Flutter lets a patient launch a search from a prescription item using its remaining quantity, or enter a quantity manually. Without coordinates, results are alphabetic and carry no calculated distance. The patient Flutter screen uses saved coordinates when available or asks for explicit coordinates; it does not fabricate a patient location. Search results expose no patient identity or prescription identifiers. Availability is time-sensitive information.

**MEDICINE AVAILABLE** means the current inventory record reports a quantity. **MEDICINE RESERVED** is not implemented. **MEDICINE DISPENSED** appears only after a committed dispensing record and inventory update. Search quantities are advisory until dispensing commits.

The current inventory model has a single qualitative stock row per pharmacy/medicine, not stock batches, lot numbers, expiry dates, or reservations. The service fails closed when inventory is unknown or ambiguous and does not treat an out-of-stock qualitative row as dispensable.

## Secure handoff reference

The patient/guardian or prescriber may request an opaque, cryptographically random 32-byte reference (43 base64url characters). Only its SHA-256 hash is stored. The response returns the plaintext once; it contains no patient name, diagnosis, or medication data. Its expiry uses the existing `DISPENSE_CODE_TTL_HOURS` setting. Issuing a replacement revokes earlier references; the patient or guardian can revoke the active reference.

The reference alone grants no access. An authenticated pharmacist must select a pharmacy and pass the verified membership check before reference resolution. Verification returns only the minimum prescription and stock details needed for fulfilment. Verification and dispensing responses are excluded from generic idempotency response caching so plaintext references and protected prescription views are not persisted there. Reference creation also avoids generic response caching. No QR payload or camera scanning is implemented; manual reference entry is supported in Staff Web.

## Staff Web and dispensing transaction

The unified Staff Web adds the `/pharmacy` workspace and pharmacist-only navigation. It lists the pharmacist's verified pharmacies, accepts manual reference entry, displays a restricted prescription view, and supports partial or full item quantities. It explicitly states that stock is not reserved and medication substitution is unsupported.

A pharmacist's verified lookup creates a pending dispensing session. Completion then:

1. Rechecks membership, prescription eligibility, reference expiry/revocation, item identity, remaining prescribed quantities, and confirmed stock.
2. Locks the prescription row and conditionally decrements inventory inside one PostgreSQL transaction.
3. Writes item-level dispensing history, updates the dispensing status and prescription completion state, enqueues a privacy-minimized notification, and appends Audit Ledger events in that same transaction.
4. Persists an idempotency key and canonical request hash. Same-request retries return the stored result; reuse with a different request is rejected.

Failed inventory or record writes roll back together. Row locking and conditional quantity updates prevent concurrent over-dispensing and negative stock. A prescription may be partially dispensed in multiple events until each prescribed quantity is exhausted. No medication substitution is allowed.

## Patient experience

Patient Flutter reads the existing prescription list, then fetches Pharmacy fulfilment read-back for each prescription. It displays fulfilment status, prescribed/dispensed/remaining amounts, facility pharmacy availability, and persisted dispensing history. It can issue or revoke a handoff reference while online; the reference is held only in screen memory and is not cached for offline use. Account changes clear prescription, fulfilment, dispensing history, handoff reference, availability results, and search inputs. A per-owner generation check discards late account-bound responses before they update the screen. Offline transitions continue to clear online prescription, fulfilment, and reference state. Existing medication search only displays a distance when the API returned one.

## API routes

Pharmacy routes added or extended:

- `GET /prescriptions/{prescription_id}/fulfillment`
- `POST /prescriptions/{prescription_id}/dispense-code`
- `POST /prescriptions/{prescription_id}/dispense-code/revoke`
- `GET /pharmacist/me/pharmacies`
- `POST /dispensing/verify`
- `POST /dispensing/{dispensing_id}/complete`
- `GET /pharmacies/medication-search` accepts optional coordinates, radius, and required quantity

The prescription contract includes optional `quantity_prescribed` and `valid_until`; the clinician UI requires these when creating prescription items. OpenAPI generated types are in `Web/packages/api/src/generated/schema.d.ts`.

## Audit and notifications

Audit Ledger events include handoff created, verified, revoked, dispensing started, partial, completed, and rejected attempts where a safe reason code is available. Events contain IDs, pharmacy scope, counts, expiry, and reason codes as appropriate; they do not contain reference plaintext, tokens, diagnosis, notes, medication lists, or contact details. Rejected-attempt audit events use no unresolved/nonexistent entity foreign key.

Notification service templates for handoff-ready and fulfilment updates are generic and privacy-minimized. They do not include medication names or clinical details. Queueing a notification is not proof of delivery; the local provider remains development console and no carrier delivery is claimed.

## Acceptance evidence

Automated database tests were executed against the isolated PostgreSQL 17 `ahealth_test` database on loopback port `55437` (earlier runs used `55433`). All 18 migrations, including Phase C, are applied. Live acceptance used a separate isolated `ahealth_dev` database on loopback port `55432`. Windows PostgreSQL `5432` and unrelated checkouts were left untouched. All acceptance records are synthetic and test-only.

- Pharmacy DB-backed tests: **12/12 passed**, including high-entropy/hash-only references, rotation/revocation/expiry, owner checks, membership authorization, facility stock, partial/full dispensing, quantity limits, idempotent replay, inventory rollback, concurrency, cancellation, and Audit Ledger integrity.
- Consultation tests: **28/28 passed**. The offer-lifecycle test now closes its test-only PostgreSQL event-bus publisher so the Node test worker exits cleanly.
- Notification tests: **9/9 passed**, including privacy-minimized templates.
- Auth tests: **30/30 passed**, including the concurrent Audit Ledger append regression. Reproducing that regression exposed that the default 2-second transaction-start wait could expire under lock contention; the Audit appender now uses a bounded 10-second transaction-start wait and 10-second transaction timeout. Both limits are finite. Dispensing passes its caller transaction into the appender, so its audit event remains atomic with inventory and dispensing writes and still rolls back with them. Auth build passed.
- Prisma schema validation: passed. All 18 migrations, including Phase C, applied to isolated `ahealth_test`; migration status is up to date.
- Pharmacy, Consultation, Notification TypeScript builds: passed.
- Staff Web type-check and production build: passed.
- Flutter full suite before the account-isolation regression: **98 passed, 6 skipped**. Current focused tests: offline/cache suite **11/11 passed** and Patient Care suite **9/9 passed**. The new deterministic A-to-B widget regression loads synthetic Patient A prescription, dispensing history, pharmacy details and a visible handoff reference; clears them on session change; confirms Patient B's authorized empty list and owner-scoped medication cache through the existing `Db` wrapper and its in-memory sqflite `Database` test double; and releases a late Patient A pharmacy-availability response to verify it cannot update Patient B's UI. It does not use an on-device SQLite file. The regression uses synthetic authorized API responses and `Session.clear`/`Session.save`; it is not live OTP-driven acceptance. The separate session-gated authenticated Pharmacy widget assertions passed **2/2** for Patient A's completed prescription and Patient B's authorized empty list, using minimized live API snapshots; the handoff reference is excluded.
- Flutter analyzer: no errors. It reports 29 informational style diagnostics in existing unbraced conditionals and existing test collection literals; none are on newly added Phase C routing, repository methods, or test assertions.
- OpenAPI type generation and semantic lint: passed. Redocly reports 37 existing specification warnings (including missing 4xx responses across older operations and ambiguous payment paths); there are no schema errors.
- `git diff --check`: passed at the time of this document update.

### Live synthetic acceptance — 2026-10-13

- A guarded local-only fixture provisioner created synthetic patients, a verified test clinician, three pharmacist identities, and three synthetic pharmacy memberships. It refuses production targets and PostgreSQL `5432`, verifies the connected database identity before writes, uses the existing password hash function, and stores credentials only in ignored `Web/.local/pharmacy-acceptance.env`. This fixture metadata is for isolated acceptance only; it is not a real-world professional-license verification process.
- Real Firefox Staff Web logins passed for Pharmacist A, Pharmacist B, Pharmacist C, the synthetic clinician, and a synthetic `platform_admin`. A and B accessed their own memberships. C's attempt to use A's pharmacy was denied with HTTP 403 and no prescription details. Patient, clinician, and platform-admin dispensing writes were denied with HTTP 403; platform admin does not inherit pharmacist rights.
- One synthetic consultation was created and completed through the existing clinician workflow, producing one signed synthetic prescription. Pharmacist A recorded a partial dispense of 4/10; Patient A read back 4 dispensed, 6 remaining, and one history event. Pharmacist B dispensed the remaining 6. Patient A then read back the completed prescription, 10 dispensed, 0 remaining, and two persisted history events. Inventory read-back was A=1, B=14, C=20.
- Re-verification after completion was denied with HTTP 409 `PRESCRIPTION_NOT_ACTIVE` and returned no prescription details. An invalid reference returned HTTP 401 `HANDOFF_REFERENCE_INVALID`; after Patient A revoked the reference, lookup returned HTTP 401 `HANDOFF_REFERENCE_REVOKED`.
- Patient B's own prescription-list endpoint returned HTTP 200 without Patient A's prescription. Patient B's direct prescription, other-patient list, fulfilment/history, and handoff requests each returned HTTP 403 `NOT_RESOURCE_OWNER`. This is live server-side isolation evidence. Patient B's authenticated list also drove a Flutter empty-list assertion. A separate deterministic widget transition verified screen/cache isolation and late-response rejection; live OTP-driven in-app switching remains **NOT EXERCISED**.
- Patient A's authenticated Flutter widget read-back rendered the completed prescription, facility availability, and both dispensing-history entries. Patient B's authenticated Flutter widget assertion rendered the authorized empty prescription list without Patient A's synthetic medication or facility data. Both used minimized live API snapshots. The snapshots contain no handoff reference, access token, or patient identity. This is widget acceptance, not a physical-device run or a Flutter network login.
- Auth Audit Ledger verification against live `ahealth_dev` returned `VALID` for 60 checked events.
- The latest acceptance artifacts and screenshots are ignored under `Web/.local/evidence`; none are intended for commit.
## Unsupported clinical and governance rules

- Professional pharmacist license verification and pharmacy-membership provisioning need an approved operational policy.
- Prescription validity duration is selected by the clinician; no clinical default or rule is invented here.
- Stock reservation, lot/batch expiry, and multi-pharmacy cross-item cart guarantees are not supported.
- Medication substitution, automatic transfer, payment settlement, insurance adjudication, HL7/FHIR, external health-record exchange, and real SMS carrier delivery are out of scope.
- Production deployment and live clinical use are not approved by this phase.
