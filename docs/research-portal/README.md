# A-Health Governed Research Portal — RC1

Status: implemented first-party service/UI candidate; **not production-approved**. Built 23 October 2026 from the owner's handoff archive. Nothing has been deployed to the owner's machine, GitHub, database, or a hospital.

## Product scope

The portal is **free** for independent and institutional researchers. There is no purchase, subscription, export or API fee. Rate limits and privacy controls apply regardless of payment. Researchers work within a purpose-specific project, not an unrestricted copy of the clinical database.

This implementation extends the existing **Research service** and **Staff Web**. It is not a separate demo application. It uses the existing JWT/session layer, Prisma, PostgreSQL and hash-chain Audit Ledger. Hospital data enters research-only tables through explicit source grants. Researchers never query live consultation tables through this portal.

### Staff Web entry points

- `/analytics/research`: researcher workspace; existing `researcher` accounts enroll as independent/institutional and request project access.
- `/admin/research`: `platform_admin` review desk or `facility_admin` named source-steward workspace.
- Researchers now land on the governed portal, not disease-surveillance pages. The surveillance backend already denies the researcher role; operational surveillance remains separate.
- Existing researcher account provisioning/authentication is reused. **Public self-service Auth signup/invitation/email verification is not added.** An authorized operator must provision the existing researcher role through the organization's controlled process.

## Implemented workflow

1. **Researcher verification.** Researcher selects independent/institutional, enters display name, credentials reference and institution (required for institutional). An identity PDF is uploaded, malware-scanned and encrypted. Platform admin verifies external evidence before marking the profile verified. A typed reference alone grants nothing.
2. **Hospital authorization.** Admin registers a collection, active facility, named active facility-admin steward, agreement reference and expiry. Agreement PDF is required. A different admin approves the source. An ordinary facility-admin role alone cannot ingest another facility's source.
3. **Structured ingestion.** The named steward submits up to 500 structured events per request. Source event keys are idempotent; a changed payload under the same key is rejected. Direct identifier fields are discarded; unsupported fields including clinical/imaging free text are rejected. Rejections disclose row positions and codes only, not input data.
4. **Protected staging.** Exact age becomes a ten-year band (90+ top-code), date becomes quarter, location is region-only. Patient linkage uses dataset-and-source-scoped HMAC. Clinical values, dose and duration remain encrypted in staging; they are not in the current public aggregate output. There is no raw-payload archive.
5. **Vocabulary and publication.** Admin records a verified standard-concept mapping with system, source code, domain, concept ID and vocabulary version. Unknown codes remain staged, not published. A prepared immutable release groups unique within-source subjects into canonical cells; cells below at least 10 participants are withheld. A different admin reviews provenance, mappings, small-cell and overlapping-release risks before publication.
6. **Project request.** Verified researcher creates study title, question/purpose, requested dataset, ethics reference/expiry, controller reference, access expiry, export/eCRF scope. Protocol, ethics and controller PDFs are required before submission. Administrator checks external approvals and grants a bounded project pinned to one release.
7. **Analysis.** Approved researcher filters only published cells by age band, sex, region, quarter, domain or code. No custom SQL, arbitrary regrouping, exact dates, patient rows, suppressed counts or hidden denominators are exposed. Counts can overlap across cells and must not be summed as unique patients.
8. **Exports.** CSV, real XLSX, JSON and XML requests require project export scope and a separate output review. Download rechecks account, researcher verification, study, release, source grants, facility and all expiries. File responses use a base64 JSON envelope through the existing BFF. CSV formula protections and explicit XLSX string cells are included.
9. **Research API.** A researcher creates a project-scoped, read-only key shown once. Only its hash is retained. Key maximum lifetime is 30 days or the project's earlier expiry. The API returns published aggregates in JSON/XML and rechecks grants on every read. Keys can be revoked. There is no row-level API.
10. **eCRF.** Approved projects may create immutable forms with bounded numeric, coded-choice and boolean fields. Another admin checks the protocol before publication. A researcher records one response per study subject per form with a documented consent-reference attestation. Responses are encrypted and never mutate clinical records. **A response-to-dataset ETL or general eCRF row browser/export is not implemented.**
11. **Audit.** Successful mutations and evidence/aggregate/export/API reads append minimal metadata inside the same transaction as the protected action. Values, clinical payloads, evidence documents and secrets do not appear in these new audit metadata. This does not certify all legacy logging. Audit failure rolls back the protected action; rate counters are separate committed transactions.

## Privacy boundaries and important limitations

- De-identification is not a guarantee of anonymization. Quasi-identifiers, auxiliary data, multiple releases and longitudinal linkage need a formal disclosure-risk review. No legal/privacy certification is claimed.
- One source per dataset release is enforced. This prevents a patient appearing at multiple hospitals from incorrectly inflating the minimum distinct-person threshold. Multiple hospitals can supply **separate datasets**. Cross-hospital subject linkage and pooled cohorts require a separate validated design.
- Publication is a fixed snapshot, not live arbitrary querying. Governance reviewers must consider differencing across snapshots before approving release. No mathematical differential-privacy guarantee is claimed.
- `RESEARCH_REAL_DATA_INGEST_ENABLED=false` by default. Real-data enablement does not itself establish a lawful basis. External ethics review, data-controller authorization, agreements, patient-consent/opt-out policy, regulatory assessment and operations approval remain necessary.
- Private research tables are logically separated and sensitive fields encrypted in the existing database. A separately deployed research warehouse, infrastructure-level encryption, TLS, backup encryption, key rotation/migration, disaster recovery and independent penetration testing are **deployment work**, not automatically provided by this patch.
- Structured source input is available; automatic scheduled hospital/EHR/FHIR pulls, DICOM images and free-text imaging/NLP de-identification are **not implemented**.
- Coding systems accepted for mapping include ICD10, ICD11, LOINC, RxNorm, SNOMED, CPT and LOCAL. No vocabulary content or licence is bundled. Unit strings are checked structurally; there is no complete UCUM vocabulary validation.
- **OMOP status: mapping-readiness only, not a complete OMOP CDM implementation.** PERSON, OBSERVATION_PERIOD, complete standardized vocabulary loads, date-policy ETL, CDM physical tables and network-study validation are not supplied. The portal does not offer a misleading “OMOP-compliant download”.
- List endpoints return a maximum of 100 recent governance records; a mapping list is capped. Releases accept up to 20,000 staged events and 5,000 publishable cells. These are bounded baseline capacities, not a national-scale throughput claim.
- English UI is implemented; full Kiswahili localization is not part of this increment.

## Legacy research endpoint change

`POST /research/queries` and `GET /research/queries/:query_id` now reject direct clinical aggregation/historical result release with 403. A free-text ethics string no longer unlocks operational data. Legacy catalogue may return descriptive metadata but not operational record counts. This intentional compatibility change is tested and should be communicated to any old analytics client.

## Operational setup (staging only until release gates pass)

1. Review the patch in a separate branch/worktree; preserve ongoing local changes.
2. Inspect the additive migration `20261024090000_governed_research_portal`. It adds research tables/indexes/FKs, not patient data or provider credentials. On the 22-migration handoff this is migration 23; on prior payment RC1 it becomes migration 24.
3. Use an explicitly approved **disposable test database/schema** on a non-5432 loopback port for migration/build tests first. The app's existing `dev:local` launcher may auto-apply migrations. **Do not run that launcher just to preview this update.** No reset/drop or `db push` is needed.
4. Set the Research service environment through the existing ignored local config/secret manager:
   - `RESEARCH_PORTAL_ENABLED=true` only after migration/config verification.
   - `RESEARCH_REAL_DATA_INGEST_ENABLED=false` for synthetic staging.
   - `RESEARCH_ENCRYPTION_KEY`: a randomly generated, canonical base64 32-byte key.
   - `RESEARCH_LINKAGE_KEY`: a different randomly generated base64 32-byte key.
   - `RESEARCH_CLAMD_HOST=127.0.0.1` (or approved loopback sidecar hostname).
   - `RESEARCH_CLAMD_PORT=3310` (change to the explicit sidecar port as needed).
   Never print/share real keys. Key generation can use Node crypto `randomBytes(32)` inside your secure provisioning process. Preserve keys across restarts; silently changing them would make encrypted evidence unreadable.
5. Supply a current ClamAV sidecar in the trusted local environment. PDF headers alone are not a safety check; evidence upload fails closed if scanning is unavailable, times out or does not return exact `stream: OK`. There is **no production scanner bypass**. Synthetic scanner stubs exist only inside tests.
6. Provision two authorized governance admins, a researcher and a named facility steward using existing approved Auth tooling. This patch does not create accounts or share credentials.
7. Run database migration/generation, backend/Next builds, contract generation, authenticated acceptance and actual scanner tests in staging. Only then schedule any deployment change.

## Commands (run after the operator has verified the explicit staging target)

From the monorepo root:

```text
pnpm --filter @a-health/database exec prisma validate
pnpm --filter @a-health/database exec prisma migrate deploy
pnpm --filter @a-health/database generate
pnpm --filter @a-health/api generate
pnpm --filter @a-health/api lint
pnpm --filter @a-health/research build
pnpm --filter a-health-web type-check
pnpm --filter a-health-web build
```

Database-free source tests, using the repository's installed TypeScript:

```text
node --test verification/research-portal/*.test.cjs
```

Windows PowerShell versions differ in native wildcard expansion. Use the included `verification/research-portal/run.cjs` runner instead:

```text
node verification/research-portal/run.cjs
```

The explicit Prisma test is in `services/research/src/tests/research-portal.database.test.ts`. It skips unless `AHP_RESEARCH_DB_TESTS=1`. It also requires `NODE_ENV=test`, a valid `DATABASE_URL` targeting `ahealth_test?schema=public` or an owned `ahp_test_*` schema in `ahealth_dev`, and a non-5432 loopback port; the live identity is queried before writes. It never provisions/drops schemas or starts databases. It leaves synthetic rows for inspection. Review and approve those writes before running it.

## API contract

The source contract is `packages/api/openapi/research-portal-v1.yaml`, linked from the main API specification. Existing generated `schema.d.ts` was not fabricated or manually regenerated in this environment; run the pinned API generation command in staging. The React client uses its reviewed explicit portal types and the existing authenticated BFF.

The machine endpoint is:

```text
GET /research/projects/{project-id}/aggregates?format=json
Authorization: ResearchKey <one-time-issued-project-key>
```

The Research service mounts this route directly (normally port 4019). An external deployment gateway may add its configured `/api/v1` prefix; do not assume that prefix on the direct service URL. JSON/XML are supported. Normal staff endpoints use JWT, not this key.

## Decisions still requiring governance/product work

Identity validation provider, external ethical-clearance verification process, approved research consent/legal-basis policies, data retention/deletion process, allowed geography and temporal precision, vocabulary licences/mappings, cross-border transfer safeguards, dedicated research infrastructure and actual hospital integrations.

## Primary references consulted

- OHDSI OMOP CDM 5.4: https://ohdsi.github.io/CommonDataModel/cdm54.html
- OHDSI CDM overview: https://ohdsi.github.io/CommonDataModel/
- NIMR health research regulation: https://nimr.or.tz/health-research-regulations/
- Tanzania PDPC mandate: https://pdpc.go.tz/pdpc-mandate/
- Tanzania PDPC Act resource: https://pdpc.go.tz/the-personal-data-protection-act-2022/
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

These references informed safeguards, not a claim of regulatory approval.
