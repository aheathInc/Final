# AHP — Patient Journey: Source Audit & First Defensive Change

**Tarehe:** 20 Oktoba 2026  
**Msingi:** ZIP iliyopakiwa `AHP-Final-Complete-Source.zip`  
**Commit iliyotajwa na handover:** `901dc9366f2eeb524fb04329eb95e7576e60201b`  
**Hali:** Source-based review + isolated unit execution. Siyo full-system, clinical, legal au production certification.

## 1. Kazi iliyofanyika katika pass hii

Archives tatu zimehakikiwa kwa SHA-256 na ZIP CRC. Source ya main imetolewa katika directory yake; Premium UI na Demo zimetolewa tofauti, bila ku-overlay source. Pending archives zinatumia Windows backslash separators; extraction ilizinormalize baada ya kukagua absolute paths, path traversal na symlinks. Main manifest ina rows 957; zote zililingana na bytes zilizotolewa.

Handover yenyewe inaeleza kuwa local database password components 50 katika files 49 zilibadilishwa **kwenye archive copy pekee**. Kwa hiyo hii ni sanitized export ya commit iliyoripotiwa, si Git checkout iliyothibitishwa kupitia remote katika mazingira haya. Hakuna `.git` history iliyopakiwa. Original ZIPs hazijabadilishwa.

Nimefuatilia code paths za Flutter login/intake/doctor directory, Auth registration/OTP, Consultation creation/routing/queue/completion, Follow-up/adherence, pamoja na sehemu za Diagnostics, Insurance, Payments na Families. Majina na line ranges chini ni za baseline archive, si za pending UI/demo.

## 2. Muhtasari kwa mmiliki

Msingi wa huduma upo, lakini **mfumo wa kuondoa foleni ya reception ulioueleza haujakamilika kama safari moja inayounganisha hospitali, huduma, bima/malipo, routing na arrival/queue status.** Kuwepo kwa screen au service si sawa na kukamilika kwa safari hiyo.

| Eneo | Kilichoonekana kwenye source | Hali ya ushahidi wa pass hii |
|---|---|---|
| Registration / OTP | Registration, challenge-hash verification na profile creation zipo | Source reviewed; live Auth haijaendeshwa |
| Symptom → department | Flutter hutuma code `general`; triage haitumii free text; offer ranking hutumia `general_practice` | Source + isolated behaviour probes |
| Doctor availability / queue | Directory na queue APIs zipo; queue counts/estimates si hospital check-in queue | Source reviewed |
| Consultation patient/thread isolation | Existing thread haikulinganishwa na selected patient kabla ya writes | Baseline failure reproduced; candidate unit regression passed |
| Follow-up | Scheduler inaweza kuandika `recovered` kutokana na end date na zero deviations pekee | Behaviour reproduced with in-memory doubles |
| Reminders | Dose rows, templates na notification dispatcher zipo | Scheduled end-to-end delivery haijathibitishwa; producer gap imeonekana kwenye search |
| Insurance / payments | Local coverage read na payment-intent infrastructure zipo | Front-desk eligibility/payment orchestration haijaonekana kwenye paths zilizokaguliwa |
| Partner diagnostics | Order/result/acknowledge APIs zipo | Hospital lab order/result integration haijathibitishwa |
| Family packages | Family tiers na GP/OB-GYN assignment models zipo | Paid subscription lifecycle haijathibitishwa |

**Kipaumbele cha engineering:** patient identity/ownership na record truthfulness kwanza; kisha routing/queue orchestration; kisha integrations na UI inayowakilisha hali halisi.

## 3. Findings zenye source evidence

### AHP-001 — Consultation inaweza kuunganishwa na thread ya mgonjwa tofauti

**Priority:** High; defensive fix candidate imeandaliwa.

`createConsultation` hukagua selected patient kwa caller mwenye role `patient`. Hata hivyo, `care_thread_id` ikitolewa, function husoma thread, hukagua existence, na inaweza kuifungua tena ikiwa closed. Hakukuwa na check kwamba `thread.patientProfileId === patientProfileId`. Baadaye huunda consultation yenye selected patient na thread hiyo, na kusasisha counters za thread.

Sources:
- `services/consultation/src/routes/consultation.routes.ts:21` — authenticated creation endpoint.
- `services/consultation/src/types/consultation.types.ts:3–22` — optional patient and care-thread IDs.
- `services/consultation/src/services/consultation.service.ts:189–197,233–284` — ownership check and existing-thread write path.
- `packages/database/prisma/schema.prisma:657–663` — consultation patient and thread are separate relations.
- `packages/database/prisma/migrations/20260812114735_init/migration.sql:790–793` — independent foreign keys; they do not establish same-patient equality.

**Executed evidence:** Actual `createConsultation` source was transpiled and executed with explicit in-memory Prisma/HTTP/triage doubles. Nine safety regression cases: original 5 pass / 4 fail; candidate 9 pass / 0 fail. Four rejected cases are foreign open thread, foreign closed thread, mismatched dependent thread and mismatched admin association. Valid own-thread and guardian cases remain accepted in these tests.

**Candidate change:** Six added lines inside the transaction, before reopening or creating records. A mismatched thread returns the existing `403 / NOT_RESOURCE_OWNER` error without successful writes in the tested path. No schema/API shape, role expansion, Auth bypass, UI or migration change.

**Boundary:** This proves the service-level control-flow gap and candidate guard under doubles. It does not prove exploitation against a live deployment or complete a database/HTTP integration security assessment. The full guard for every actor role remains a separate review item below.

### AHP-002 — Staff creation policy is not fully established by the current endpoint

**Priority:** High; source finding, not fixed here.

The selected-patient ownership check is conditional on `caller.role === 'patient'`, while the route has `requireAuth` rather than an explicit creator-role policy. A patient/thread consistency check alone does not answer which staff actors may create a consultation for which patient.

Sources: `services/consultation/src/routes/consultation.routes.ts:21`; `services/consultation/src/services/consultation.service.ts:189–197`.

Next verification must define and test allowed patient/guardian/staff workflows before changing permissions. Do not infer that every authenticated staff role may act on every patient. Candidate AHP-001 deliberately does not invent that policy.

### AHP-003 — Free-text symptom intake is not department routing

**Priority:** High for the proposed digital front desk; not fixed here.

Flutter sends the narrative and one structured symptom whose code is always `general`. The triage function accepts `freeText` in its input type but does not consume it in its implementation. It can return a structured-code specialty hint, but `offerConsultation` supplies `requiredSpecialty: 'general_practice'` and `patientLanguage: 'sw'` to the matcher instead of consuming the result. The source `Specialty` enum has no distinct dentistry entry.

Sources:
- `apps/patient-mobile/lib/screens/new_consultation_screen.dart:38–58`.
- `services/consultation/src/engine/triage.ts:23–38,70–145`.
- `services/consultation/src/engine/ruleset.ts:109–121`.
- `services/consultation/src/services/consultation.service.ts:98–104,221–229,259–274`.
- `packages/database/prisma/schema.prisma:82–92`.

**Executed evidence:** An app-shaped synthetic adult request containing dental free text still returned `general_practice`. Changing only the free text did not change the result. A separate structured `rash` input did exercise the existing `dermatology` hint. These are software-behaviour observations, **not validation of clinical triage rules**.

Do not advertise automatic dental-department routing as complete. A future change needs facility service catalogs, approved structured intake, safe routing/fallback policy and persisted routing context. Do not add medical routing rules by guessing.

### AHP-004 — Existing queue information is not a facility reception/check-in queue

**Priority:** High for reducing reception queues; not fixed here.

Patient queue position counts open consultations with matching urgency and earlier SLA deadlines across the query, without a facility/department/selected-clinician constraint. Waiting-time computation uses the available-clinician count and a fixed multiplier of ten minutes. The doctor directory's `queue_count` is assigned active consultations plus actionable offers; that is not necessarily a physical waiting-room headcount. The Flutter directory fetches in `initState`; this screen has no subscription/polling in the inspected file, unlike the consultation-detail screen's bounded polling.

Sources:
- `services/consultation/src/services/queue.service.ts:96–149`.
- `services/doctor/src/services/clinician.service.ts:90–109`.
- `apps/patient-mobile/lib/screens/doctor_directory_screen.dart:23–38,83–100`.
- `apps/patient-mobile/lib/screens/consultation_detail_screen.dart:76–78`.

Needed distinction: doctor workload, actionable offers, booked appointment, patient checked-in, waiting for triage, and being served. These must not be relabeled as interchangeable queue positions.

### AHP-005 — Follow-up can infer recovery from absence of recorded deviation

**Priority:** High data-truthfulness concern; not fixed in this candidate.

The scheduler sees an active cycle past `endDate`. When `openDeviationCount === 0`, it writes `status: 'completed', outcome: 'recovered'` and detaches the active follow-up cycle. It does not read patient responses first. The existing regression test expects this automatic closure.

Sources:
- `services/followup/src/workers/scheduler.worker.ts:19–54`.
- `services/followup/src/tests/followup.test.ts:220–239`.
- `services/followup/src/services/checkin.service.ts:175–213` — existing explicit closure path.

**Executed evidence:** With an expired synthetic cycle, zero deviations and no check-in response reads, the actual scheduler source attempted the `recovered` write. A separate probe showed an empty response against a configured red-flag field returns `isDeviation: false`.

Zero recorded deviations cannot, by logic alone, distinguish recovery from no response, missing data or an unevaluated criterion. The correction needs an explicit outcome policy and clinician review, not a timer that invents a clinical outcome. This pass leaves that workflow unchanged and records it for the next scoped change.

### AHP-006 — Medication reminders: stored schedules do not establish delivery

**Priority:** High for follow-up claims; not fixed here.

Consultation completion creates adherence rows spaced from `Date.now()` by frequency per day. The schema correctly defaults doses to `unreported`; confirmation accepts `taken`, `missed` and `delayed`. Notification templates for adherence/check-ins exist, and the dispatcher drains notification rows already queued. A search across backend services found template definitions/tests but no other use of `adherence.reminder` or `checkin.due`; the follow-up scheduler creates check-ins, not those notification rows. The inspected Flutter source contains no local-notification scheduling implementation found by the targeted search.

Sources:
- `services/consultation/src/services/consultation.service.ts:489–512`.
- `packages/database/prisma/schema.prisma:186–191,891–900`.
- `services/followup/src/types/followup.types.ts:14–19`.
- `services/followup/src/workers/scheduler.worker.ts:60–100`.
- `services/notification/src/services/templates.ts:41–48`.
- `services/notification/src/workers/dispatch.worker.ts:28–42,70–110`.
- `apps/patient-mobile/pubspec.yaml:14–22` and targeted source search.

Conclusion is deliberately limited: reminder delivery is **not established by this source path**, not a claim about every possible external integration. Preserve `unreported` as not confirmed; do not automatically rename it missed. An end-to-end reminder change needs scheduling ownership, agreed treatment start/timezone, dispatch, retry, acknowledgement and clinician escalation evidence.

### AHP-007 — Registration payment and facility insurance eligibility are not one entry workflow

**Priority:** Product integration gap; not fixed here.

Registration/OTP can create and activate a patient profile. The inspected registration and consultation-creation functions have no registration-fee invoice/settlement or facility eligibility orchestration. Insurance coverage reads local membership rows; `accepted_at_facility` is explicitly always null. The payment request accepts an amount and purpose, and the inspected provider adapter is a console adapter.

Sources:
- `services/auth/src/services/auth.service.ts:123–176,245–328`.
- `services/consultation/src/services/consultation.service.ts:173–307`.
- `services/insurance/src/services/insurance.service.ts:7–42`.
- `services/payment/src/types/payment.types.ts:3–13`.
- `services/payment/src/adapters/provider.ts:15–38`.

The owner's proposed F1 price was an example, not an approved tariff. Do not invent a fee, force payment to unlock all care, or mistake a local membership for confirmed acceptance by a partner hospital. Billing, exemptions, failed settlement and facility-specific entitlements require explicit decisions.

### AHP-008 — Diagnostics exists, but partner-laboratory coordination is not proven

**Priority:** Integration gap; not fixed here.

Diagnostics exposes order creation/read, result filing and acknowledgement. Result filing is limited to the ordering clinician or platform admin. These endpoints do not by themselves demonstrate a partner-laboratory identity, specimen/processing workflow, verified external result delivery or linkage to the hospital's own laboratory system.

Sources: `services/diagnostics/src/routes/diagnostics.routes.ts:15–19`; `services/diagnostics/src/services/investigation.service.ts:64–91,134–147,208–223`.

AHP should coordinate an authorized order/result handoff while the partner hospital performs and verifies its tests, consistent with the owner's stated business boundary. Phase D's generic FHIR record import must not be presented as proof of a native diagnostic order/result integration without executed mapping evidence.

### AHP-009 — Family assignment exists; subscription benefits are not established

**Priority:** Product integration gap; not fixed here.

The schema has `family_basic` and `family_plus`, members and GP/OB-GYN assignments. `createFamily` stores the caller-supplied subscription tier; the reviewed family routes do not implement payment activation, renewal, benefit counters or subscription expiry. A tier field is not proof of a paid entitlement.

Sources: `packages/database/prisma/schema.prisma:1528–1532,2628–2687`; `services/families/src/routes/families.routes.ts:15–18`; `services/families/src/services/family.service.ts:18–33,147–205`.

The existing family feature is useful, but the paid family-care package described by the owner needs separately defined billing, service commitments, clinician capacity and adult-member privacy rules.

### AHP-010 — Flutter still advertises a removed debug OTP shortcut

**Priority:** Development/UX mismatch; not fixed here.

The debug login screen includes a button labelled `INGIA KAMA TESTER (Bypass OTP)` and sends a fixed code. Backend verification instead compares the supplied code with the challenge hash; security configuration resolves bypass to false. This is stale frontend behaviour, not evidence that production OTP bypass still works.

Sources: `apps/patient-mobile/lib/screens/login_screen.dart:56–88,132–137`; `apps/patient-mobile/lib/screens/verify_screen.dart:84–86`; `services/auth/src/services/auth.service.ts:261–287`; `services/auth/src/config/security.ts:65–90`.

Remove the misleading shortcut or replace it with the supported local OTP workflow in a separately tested Flutter change. Do not reintroduce server bypass to satisfy the debug button.

## 4. Tests actually executed here

Environment: Node 22.16.0; locally available TypeScript transpiler 5.8.3. The repository declares a different locked toolchain. This isolated run does not replace its builds or lockfile-based CI.

| Execution | Result | Meaning |
|---|---:|---|
| Main archive manifest | 957/957 hashes match | Baseline extracted intact |
| Ownership unit regression on baseline | 5 pass, 4 fail | New safety requirements detect baseline gap |
| Same regression on candidate | 9 pass, 0 fail | Narrow guard passes these service-level cases |
| Baseline behaviour probes | 5 observations reproduced | Includes undesirable behaviour; not five product approvals |
| Patch apply-check on isolated normalized source | PASS | Patch produces the expected candidate file |

No real PostgreSQL, JWT login, HTTP middleware, browser or phone was used by these tests. Database, Auth, event and routing collaborators are explicit doubles for the ownership tests. Behaviour probes execute the actual baseline triage/deviation functions and scheduler with doubles. No real clinical records or secrets are used.

**Not run:** full pnpm installation/build, existing DB suites, migrations, Flutter tests/analyze, Staff Web E2E, external integrations, load testing, production tests. Their historical pass counts in agent handoffs are not reused as independent verification here.

## 5. Candidate deliverable and limits

`AHP_ChangeSet_001_Consultation_Thread_Guard.zip` contains one changed runtime source file, a six-line unified patch, reproduction/regression scripts, before/after TAP evidence, and a manifest. It does not contain the complete project again.

Candidate status: **review candidate, not a release or merge approval**. AHP-002 and the other findings are not fixed by AHP-001. Before integration, run the real isolated `ahealth_test` and HTTP regressions with legitimate Auth, including valid owner, guardian, staff-policy and cross-patient cases. No commit, push or remote mutation was performed.

## 6. Work order derived from this review

1. Close patient/thread and actor-scope gaps with DB/HTTP regression. Keep the narrow patch isolated.
2. Define truthful follow-up outcomes and missing-response handling; remove automatic clinical conclusions only through an explicit reviewed change.
3. Design facility-aware digital entry: correct department/service routing, live clinician availability, check-in and scoped queue semantics. Preserve emergency escalation and human review; do not invent clinical rules.
4. Connect approved pricing/eligibility and hospital-owned lab/pharmacy handoffs to that journey.
5. Complete reminder delivery and family entitlements with reliable acknowledgement, permissions and operational ownership.
6. Apply the approved Hybrid A+C UI to truthful backend states. Review pending UI and Demo Auth changes separately; no blind patch overlay.

This is the first scoped engineering review. Research, interoperability internals, complete pharmacy logic, Docker deployment and the entire UI are **not declared audited by this document**. Tanzania-specific operational/legal requirements need their own sourced research and partner validation, distinct from the code observations above.
