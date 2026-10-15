# Health interoperability and longitudinal patient record

**FHIR R4 SUBSET â€” NOT A FULL FHIR SERVER**

All source names and sample resources in this milestone are synthetic test data only. No external hospital endpoint is contacted, and no production integration is configured.

## Architecture

The interoperability module is implemented inside the existing Network service (`Web/services/network`) to reuse its JWT validation, PostgreSQL/Prisma client, idempotency middleware, audit ledger and API routing. It adds three tables for the trusted system registry, source-scoped patient identity links and immutable source resource versions. Existing consultation, referral, diagnostic, prescription, dispensing and `MedicalRecord` rows remain authoritative; the timeline reads them as projections rather than copying them.

The additive migration is `20261013130000_health_interoperability_longitudinal_record`. It creates new enums, tables, foreign keys and indexes. It does not rewrite patient records or Audit Ledger rows. Apply it only through the approved isolated migration workflow.

The follow-up identity-state migration only adds the `rejected` enum value. These are forward-only additive migrations; no automatic down migration is supplied. A production rollback must first roll back application use while retaining the added schema. Do not drop imported-resource tables or enum values after data has been accepted without an approved retention/export plan.

## Supported FHIR R4 profiles

The service accepts one resource per request for: `Patient`, `Organization`, `Practitioner`, `Encounter`, `Condition`, `Observation`, `DiagnosticReport`, `MedicationRequest`, `AllergyIntolerance` and `Provenance`. The implementation validates supported resource type, ID format, top-level field allowlists, supported metadata, size/depth bounds, local Patient/Encounter references and required event timestamps for clinical resources. Unsupported resource types, unsupported top-level fields, extensions, contained resources, malformed references and oversized payloads are rejected. Bundles, terminology translation, arbitrary extensions, remote references, search and transaction APIs are outside this subset.

FHIR resources are stored as immutable source versions with the original JSON payload, source ID/version, source update time, event time, payload SHA-256, import time, validation state and transformation version. Source payloads are never written to access or Audit Ledger logs. API responses expose only authorized, allowlisted clinical detail fields and provenance.

## Trusted systems and integration authentication

Only `platform_admin` can register, activate, suspend or inspect systems. Registration requires an active AHP facility reference, a stable system identifier and explicit resource capabilities. A newly registered source is `pending`. Activation fails closed until the source-specific token is configured outside the database.

For a key such as `hospital-a-ehr`, the registry stores only the configuration reference `INTEROP_SYSTEM_TOKEN_HOSPITAL_A_EHR`. The Network service reads the value from its process environment or an injected secret manager. Ingress requires that token as a bearer credential plus the exact `X-Integration-System` key. Secrets are never included in API responses or logs. `Web/services/network/.env.example` contains placeholders only. No real system token is provided by this repository.

Systems can be suspended immediately. There is no outbound connection to the registered identifier or endpoint in this milestone; it is descriptive registry data only.

## Patient identity and reconciliation

An external Patient ID is scoped to its source system. Incoming patient-scoped resources use only a validated source-local `Patient/{id}` reference; an external identifier is never treated as an AHP profile ID. If a source identity is not confirmed, its imported versions remain quarantined and have no `patient_profile_id`. Name, phone, birth date and demographic similarity are never used to match automatically.

The admin review queue omits external identifiers and demographics and shows only an opaque candidate ID, source system and resource count. Only `platform_admin` can confirm a verified mapping, record ambiguous candidate profile IDs, or reject a candidate. Each decision requires a non-PHI evidence reference, is audited, preserves the source identity and never merges or overwrites AHP patient demographics. Confirming a mapping attaches its quarantined source versions to that profile; access still passes through the clinical timeline authorization check.

This milestone implements single-admin reconciliation. A dual-review policy, evidence-reference workflow and governing organization roles must be established before real external records are used.

## Consent and authorization

The patient timeline is server-authorized. Patients can read their own profile (or a dependent they guard). Clinicians must have an active verified account, an active facility assignment and an unrevoked, unexpired, non-break-glass PatientConsent directly naming that clinician or the clinician's facility. Supported scopes are `full_history`, `medications_only`, `investigations_only` and `current_thread`; the latter exposes only matching AHP-native records and never opens external records. Platform admins and integration clients cannot query a patient timeline. Consent revocation is checked on every read, not cached.

The current source registry does not model a separate patient-level legal basis for ingest. Imported data is available in the patient's own timeline after identity reconciliation; clinician visibility still requires the exact patient consent above. Governance must define and implement the required patient authorization basis for importing and retaining real external records before any real-system activation.

## Longitudinal timeline and provenance

`GET /interop/my-history` derives the active patient timeline from AHP consultations, referrals, diagnostic orders/results, prescriptions, dispensing records and other `MedicalRecord` entries, plus accepted external FHIR versions. `GET /interop/patients/{patient_profile_id}/timeline` applies clinician consent and scope filters on every request. Each entry identifies category, event date, native/imported source, facility/system, source record ID, status and verification state. External records are explicitly labeled `imported_not_clinician_verified`; import or system trust is not presented as clinical verification.

External record detail responses include source organization/system, original resource ID and version, source and import timestamps, validation state, payload hash and transformation version. The Flutter app has a non-persistent, account-scoped â€œHistoria Yangu ya Afya / My Health Historyâ€ view with category/source filters, refresh, loading/error/empty states and imported-data labeling. It does not edit imported records or persist history in an account-shared cache.

## Versioning, duplicates and conflicts

Imports are serialized per source/type/resource key with a PostgreSQL advisory transaction lock. Replaying the same version and hash returns the prior resource. Replaying a source version with different content, importing an older source timestamp, or sending conflicting content with the same timestamp is rejected. Newer versions are stored as separate immutable rows, so an update never overwrites its source history. A transaction persists resource, identity association and audit event together; an import failure does not commit a partial clinical version.

## Audit Ledger

Registry registration/activation/suspension, accepted/rejected/duplicate imports, identity reconciliation, timeline/detail access, access denial and consent revocation use the existing immutable Audit Ledger with minimal metadata. The original interoperability acceptance returned VALID for 206 events. After final native-record acceptance on 2026-10-14, the Audit Ledger returned VALID for 466/466 events. The isolated `ahealth_test` ledger also verified **VALID** after the database-backed suites (350 events). The final identity concurrency acceptance below verified `ahealth_dev` at **543/543** and `ahealth_test` at **561/561**. Network and Auth regression tests continue to verify immutability and tamper detection. Raw FHIR payloads, patient demographics, notes, tokens and credential values are not stored in audit metadata.

## API contract

The OpenAPI document and generated types are updated for:

- `GET/POST /interop/systems`, activate and suspend actions
- `GET /interop/identities/pending`, confirm, mark-ambiguous and reject actions
- `POST /interop/fhir/import`
- patient-owned and clinician-consented timeline reads
- imported record detail and provenance

The contract explicitly describes the restricted resource subset and does not claim full FHIR R4 conformance.

## Verification evidence in this worktree

- Isolated PostgreSQL 17 is running on loopback port `55439`; `ahealth_dev` is used for runtime acceptance and `ahealth_test` for mutating tests. Both connections resolved to the expected database and role `ahealth`. PostgreSQL 5432 was not used.
- Prisma validation passed. All 20 repository migrations are applied in both databases; prisma migrate status reports up to date and read-only Prisma schema diff reports no differences for either database. The migration is additive. Initial schema verification found 7 patient profiles and 1 prescription in ahealth_dev; final native acceptance now has 1 referral and 2 prescriptions. ahealth_test remains empty of patient profiles, referrals and prescriptions after the scoped suites; no database reset was run.
- Auth, Patient, Doctor, Consultation, Pharmacy, Diagnostics, Network, Facilities and Staff Web health checks all returned HTTP 200 on their Phase D local ports.
- Firefox Staff Web acceptance used real logins without cookie injection. Admin opened the interoperability workspace, registered and activated the synthetic Hospital A and Hospital B entries, registered/activated a separately keyed synthetic expanded-profile fixture, and completed identity review. Clinician login and Admin-route denial passed. An authorized assigned clinician viewed Patient A's mixed history and provenance while consent was active; an unrelated clinician was denied.
- Current `ahealth_dev` registry state has 3 active synthetic source configurations, 4 source-scoped identity rows (confirmed, ambiguous, and unmatched states), and 10 external resource versions. The expanded-profile fixture enabled `MedicationRequest` and `AllergyIntolerance` using the supported Admin registry workflow. A synthetic Patient, MedicationRequest and AllergyIntolerance were accepted by the integration-authenticated endpoint, held in quarantine before identity review, then attached to Patient A only after Admin confirmation. The API subsequently read them back with imported/unverified labels and provenance. The source-specific credential is local-only and gitignored.
- FHIR runtime acceptance retained earlier evidence for Patient, Encounter, Observation versions, DiagnosticReport, duplicate idempotency, newer-version acceptance, older/conflicting-version rejection, invalid reference, malformed and oversized payload rejection, and invalid integration credential rejection. Admin suspension of the expanded-profile source also caused a valid credential to receive HTTP 403; the source was reactivated through the supported UI afterward. Profile unit tests cover the other advertised supported resource types. This is a limited subset, not a full FHIR server.
- Identity review retained a confirmed Patient A mapping, an ambiguous candidate, and a rejected similar-demographics candidate. External identifiers were not used for automatic matching; the Admin UI hid identifiers/demographics and kept the reviewed decision source-scoped.
- Earlier interoperability-only acceptance recorded seven entries. The final native-record acceptance below adds the supported AHP workflows and supersedes that earlier timeline snapshot.
- Patient B received HTTP 200 with an authorized empty history. Patient B's direct access to Patient A's imported record and timeline returned 403. Assigned clinician access with Patient A's full-history consent passed; an unrelated clinician was denied. After Patient A revoked the consent, the same assigned clinician's timeline request returned 403.
- Flutter live widget/API acceptance passed **3/3** using legitimate Auth-issued patient sessions and the local gateway: Patient A rendered and filtered history, opened a detail and refreshed; Patient B saw the authorized empty state; and a delayed Patient A response did not repopulate the UI after switching to Patient B. Focused Health History tests passed **4/4**. The previously run full Flutter suite remains **103 passed, 8 gated skips**. No emulator or physical device was tested.
- Earlier Audit Ledger verification recorded ahealth_dev VALID, 206/206 and ahealth_test VALID, 350/350. The final identity concurrency acceptance below records ahealth_dev VALID, 543/543 and ahealth_test VALID, 561/561.
- Network DB/unit tests: **26/26 passed** against verified `ahealth_test`; a separate cross-facility consent check also passed and removed its scoped fixture rows. Auth tests: **30/30**; Patient tests: **14/14**. Network TypeScript build, Staff Web type-check and production build passed.
- OpenAPI type generation passed. Semantic lint reports a valid contract with **37 existing warnings** (ambiguous payment paths and missing 4xx declarations); no interoperability-specific finding was reported.
- Prior `git diff --check` and other listed phase checks remain recorded; rerun the final working-tree check after this documentation update.

## Final native-record acceptance — 2026-10-14

- All acceptance data remained synthetic and explicitly marked TEST DATA ONLY - NOT FOR CLINICAL USE. No new consultation was created during this acceptance pass. The existing accepted test consultation was completed through the clinician UI using a non-clinical signed note and a synthetic prescription; the referral remained in_care and was not marked completed.
- Patient A's live timeline returned 12 entries: six AHP-native entries (two consultations, one referral, one diagnostic order/result, one prescription and one dispensing record) and six external FHIR timeline entries. The external entries include two immutable versions of one Observation; the same source/type/resource/version was not duplicated. All entries were chronologically ordered, and repeat read-back preserved their references.
- Referral creation/submission in the source clinician's Firefox session and receipt, acceptance and start-care in the receiving clinician's Firefox session all passed. The Network API returned the same referral in in_care with the expected consultation and facility references.
- The diagnostic order and non-clinical result were read back from Diagnostics. The timeline identified the native AHP source, order ID, resulted status and result timestamp. The order has no facility attribution because this fixture request omitted the optional facility_id; its AHP source and record-level provenance remain present.
- The consultation completion/prescription were read back from Consultation. The prescription was associated with the same patient and consultation and carried the synthetic fixture marker. The patient-issued secure handoff was verified by a synthetic pharmacist through Firefox; the full test quantity was recorded. Patient fulfillment read-back confirmed one persisted event, pharmacy provenance and a one-unit inventory decrement.
- Patient A read their own mixed timeline with HTTP 200. Patient B received HTTP 200 with an empty authorized timeline; Patient B's direct referral, diagnostic order, prescription, dispensing, external record and Patient A timeline requests were denied with HTTP 403.
- The source clinician viewed permitted same-thread AHP-native records. While investigations_only consent was active, the clinician could also read the external DiagnosticReport; other external categories stayed hidden. After consent revocation, the external detail returned HTTP 403 while same-thread native visibility remained. An unrelated clinician's Patient A timeline request returned HTTP 403.
- Real Firefox acceptance across facilities passed. The receiving clinician's Staff Web history page showed only consented same-thread AHP-native entries and hid all external records; the unrelated clinician's page showed an authorized empty state. Reload preserved the allowed entries.
- Flutter live acceptance fetched Patient A's current timeline and Patient B's empty timeline from the live API through the local gateway. The Health History widget rendered the fresh Patient A response, category and source filters, AHP source attribution, authorized diagnostic details and refreshed read-back; Patient B's widget showed the authorized empty state without Patient A entries. The widget used the fresh API response through the existing test Dio adapter. Focused Health History tests passed 4/4 and this live widget/API acceptance passed 1/1. No emulator or physical Android device was tested.
- After the final writes, the ahealth_dev Audit Ledger returned VALID, 466 events checked and matching the row count. The isolated ahealth_test database remained empty of patient profiles, referrals and prescriptions after the scoped suites. Both databases remain on loopback port 55439; PostgreSQL 5432 was not used.

## Known limitations and governance

- **FHIR R4 subset only.** No Bundle transactions, full terminology service, subscriptions, bulk export, arbitrary extensions or remote-reference resolution.
- All registered systems, identities and resource fixtures are synthetic. No real hospital connection, real PHI or production credential has been used. The source bearer token proves possession of the configured local secret, not a hospital's legal identity, clinical authority or signature authenticity.
- Identity confirmation is an audited single-Admin decision. Dual review, national identifier policy and a governing-organization role are not implemented.
- Patient-level legal authorization for ingesting and retaining real external data is not modeled. Establish that governance basis before connecting a real source.
- Consent is checked on every patient/clinician read. Final Firefox acceptance used distinct synthetic facilities: the receiving clinician saw only same-thread AHP-native entries under facility current_thread consent; imported records remained hidden. The source clinician saw permitted same-thread native records and diagnostic imports only while investigations_only consent was active; revocation blocked the external record again.
- Patient A now has native consultation, referral, diagnostic, medication and dispensing projections alongside imported FHIR versions. See the dated final acceptance record below. Native records used for verification are explicitly test-only; none is a genuine clinical decision.
- Flutter acceptance is widget/API-level on the local runner. It is not physical-device or emulator E2E. The screen does not edit imported records or persist history in a shared account cache.
- No clinical decision support, diagnosis, medication substitution, automated patient merge, payment integration, blockchain or real-data migration is included.

## Identity race and OpenAPI security acceptance — 2026-10-14

- Root cause: identity transitions and FHIR imports did not consistently serialize on the current identity mapping, while timeline/detail reads trusted an imported row's stored patient association without independently requiring the current mapping to remain confirmed. A concurrent ambiguity decision could therefore leave a stale association visible.
- All mapping transitions and patient-scoped imports now use the same PostgreSQL transaction-scoped advisory identity lock (`interop:identity:{identityId}`). Imports acquire it before the source-resource version lock (`interop:resource:{systemId}:{resourceType}:{resourceId}`). Identity initialization re-reads under the lock. This common order serializes import, confirm, ambiguity and rejection without automatic matching.
- Ambiguous and rejected decisions atomically clear each imported row's AHP patient link and quarantine it while preserving the immutable payload, source/version data and provenance. Explicit Admin confirmation atomically restores association for quarantined versions. Audit events commit in the same transaction; the rollback regression leaves both the prior mapping and resource state intact.
- Timeline reads require an accepted resource, its stored patient association, and a current confirmed identity pointing to that same patient. Direct imported-record reads apply the same current-mapping check. Live API acceptance verified Patient A's selected source records disappeared when the Admin workflow marked the mapping ambiguous, Patient A's native records remained, Patient B stayed isolated, and explicit Admin reconfirmation restored only the selected mapping's records. Repeat reads after Staff Web refresh preserved that state.
- A synthetic Patient A consent granted the assigned clinician `investigations_only` access. The clinician could read eligible imported diagnostics while the mapping was confirmed, lost those records while it was ambiguous, regained them after explicit reconfirmation, and lost them again after consent revocation. The temporary consent was revoked after the acceptance. Patient B direct access was denied before and during the ambiguous state.
- The database-backed Network suite passed **26/26** on isolated `ahealth_test`, including confirm/import, confirm/ambiguous, reject/import races, A/B isolation, unrelated clinician denial, consent revocation and transaction rollback. Network TypeScript build and Prisma validation passed. Both databases are on loopback port `55439`, at 20 applied migrations; the test database remained free of patient/referral/prescription fixture rows after cleanup.
- The Network runtime Audit Ledger verified **VALID** after live transitions: `ahealth_dev` 543/543 events and `ahealth_test` 561/561. No migration reset was run.
- `Web/services/network/.env.example` uses explicit replacement placeholders for the local database password and JWT signing secret; no usable credential is embedded in the template. The integration-token entries remain placeholders as well.
- `POST /interop/fhir/import` now documents its source-specific credential as an opaque HTTP bearer token, without a JWT format. Ordinary patient/staff/admin routes retain `bearerAuth` with JWT. Import version conflicts document the existing HTTP 409 Conflict response; runtime `VERSION_CONFLICT` errors already map to status 409. OpenAPI type generation and semantic lint passed; lint reports the repository's existing 37 unrelated ambiguity/4XX warnings.
- Sanitized live acceptance evidence is in the gitignored `Web/.local/phase-d/evidence/identity-race-live-acceptance.json`. No credential, token, OTP, patient payload or private environment value was placed in tracked documentation.
