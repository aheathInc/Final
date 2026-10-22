# AHP — Follow-up Outcome Safety / ChangeSet 002

**Tarehe:** 20 Oktoba 2026  
**Hali:** Candidate ya review na integration testing; si production release.  
**Baseline:** sanitized source archive ya `901dc9366f2eeb524fb04329eb95e7576e60201b` iliyotolewa na mtumiaji. Git remote haikufunguliwa katika pass hii.

## 1. Finding iliyothibitishwa

Katika baseline `services/followup/src/workers/scheduler.worker.ts:19–54`, scheduler ilikuwa inachagua cycles za `active`. Cycle yenye `endDate < now` na `openDeviationCount === 0` iliandikwa `completed` / `recovered`, version kuongezwa, na `activeFollowUpCycleId` kuondolewa kwenye care thread. Hakukuwa na ukaguzi wa majibu ya mgonjwa kabla ya kuandika outcome hiyo.

Baseline test `services/followup/src/tests/followup.test.ts:220–230` ilitarajia auto-closure hii. Kwa hiyo kubadilisha scheduler bila kubadilisha test hiyo kungeacha regression expectation isiyolingana na fix.

Hili ni hitimisho la source na execution ya service function, si utafiti wa kitabibu: kutokuwa na deviation iliyorekodiwa hakutofautishi mgonjwa aliyepona na mgonjwa ambaye hajajibu.

## 2. Mabadiliko yaliyotekelezwa

### Scheduler — runtime change pekee

- Auto-write ya `completed/recovered` imeondolewa.
- Window ikiisha, scheduler haibadilishi cycle status, outcome, version au active care-thread association.
- Query sasa inachagua `status: active` pamoja na `endDate >= now` **kabla** ya `take: 500`. Hii inazuia ended cycles zinazosubiri uamuzi kujaza batch na kuzuia cycles zilizo ndani ya window kupangiwa check-ins.
- Check-in scheduling ya daily/twice-daily/weekly, horizon na inclusive end boundary imehifadhiwa.
- Existing overdue-check-in rule imeachwa: `scheduled` check-in iliyopita cutoff huwekwa `missed`. Hii ni **check-in isiyojibiwa**, si ushahidi kwamba dose ya dawa haikumezwa.
- `cyclesAutoClosed` imeachwa kwenye result shape kwa compatibility, lakini sasa ni `0`. `cyclesProcessed` sasa inahesabu in-window cycles zilizorudishwa na query, si active cycles zote.

### Explicit closure — comment correction tu

`services/followup/src/services/checkin.service.ts:170–213` bado ina explicit closure endpoint path kwa assigned clinician au platform admin chini ya ruhusa zilizopo. Runtime ya function haijabadilishwa; comment inayodai automatic closure ndiyo imesahihishwa.

Hakuna enum mpya ya `awaiting_review`. Ended cycles zinabaki `active` mpaka explicit existing close workflow itumike. Hakuna reminder, escalation au review dashboard mpya iliyoongezwa.

### Database test suite

`services/followup/src/tests/followup.test.ts` imerekebishwa kuassert active/null outcome, unchanged version, preserved thread link, no recovery inference from responded check-ins, na explicit clinician closure baada ya window kuisha.

Test fixture sasa inaweka active follow-up association kama workflow halisi inavyofanya. Pia loose URL regex ya test suite imebadilishwa na guard inayohitaji `NODE_ENV=test`, local `ahealth_test`, explicit non-5432 port, na read-only server identity check kabla ya tests. Guard hii inahusu tests pekee; haiwezi kuthibitisha umiliki wa DB kwa jina pekee. Operator bado lazima achague cluster yake disposable.

## 3. Majaribio yaliyotekelezwa hapa

| Jaribio | Matokeo | Kiwango cha uthibitisho |
|---|---:|---|
| Scheduler + explicit-close regression dhidi ya baseline | 14 PASS / 8 FAIL | Actual source functions; in-memory collaborators |
| Regression ileile dhidi ya candidate | **22 PASS / 0 FAIL** | Actual source functions; in-memory collaborators |
| DB-test target guard | **17 PASS / 0 FAIL** | Actual test bootstrap; sandboxed env and metadata probe |
| ChangeSet 001 consultation/thread regression kwenye combined candidate | **9 PASS / 0 FAIL** | Independent earlier test; in-memory collaborators |
| Patch apply-check, applied-file comparison na reverse apply-check | **PASS** | Disposable LF-normalized source copy |
| Whitespace check ya patch result | **PASS** | `git diff --check` |

**Baseline failures zimehifadhiwa** katika `evidence/scheduler-before.tap`; fix results katika `evidence/scheduler-after.tap`. Test names zinatenganisha safety cases na preserved scheduling behaviour.

Runtime ya majaribio: Node `22.16.0`, TypeScript transpiler `5.8.3` inayopatikana hapa. Hii si lockfile-based repository build; package ya Follow-up ina version range tofauti. Transpilation si full type-check.

**Hazijaendeshwa:** real PostgreSQL/Prisma integration suite, DB migrations, HTTP/JWT/OTP acceptance, full pnpm build, Flutter/browser/device tests, load tests, na clinical/operational acceptance. Revised DB test cases zimetolewa lakini hazijahesabiwa kama PASS.

Mock `$transaction` kwenye source harness si implementation ya rollback/concurrency. Hakuna dai la transaction atomicity au concurrent-worker correctness kutoka kwenye harness hii.

## 4. Mambo ambayo hayajabadilishwa

Prescription, doses, adherence statuses, medication timing, Auth/RBAC, patient consent, database schema, API routes, Flutter na Staff Web hazijabadilishwa na patch hii. `unreported` medication dose haibadilishwi kuwa `missed` kwa silence. Original source ZIP na pending UI/Demo archives zimeachwa kama zilivyopakiwa.

Mabadiliko haya hayarekebishi kiholela historical `recovered` rows. Kama mfumo uliwahi kufanya auto-closure, data review ya operator/clinician yenye audit ndiyo itahitajika kabla ya correction yoyote.

## 5. Mipaka na integration gates

1. **Operational review:** Ended cycles sasa zinabaki wazi. Kufuatilia review backlog, alerts na UI wording ni kazi inayofuata; patch haitangazi kuwa notification/escalation imejengwa.
2. **Scheduling scope:** Query filtering huzuia ended-cycle backlog kujaza batch. Haitatui batching/fairness kwa zaidi ya eligible cycles 500, duplicate check-ins za concurrent workers, au worker racing na explicit closure. Hakuna unique-slot migration iliyoongezwa.
3. **Date semantics:** Schema inatumia `@db.Date` kwa start/end (`packages/database/prisma/schema.prisma:936–937`). Existing instant comparison imehifadhiwa; inclusive hospital-local calendar-day/timezone policy haijabuniwa.
4. **Explicit-close legacy behaviour:** Existing platform-admin policy, marking remaining scheduled check-ins missed, na audit append iliyo nje ya transaction ya close function havijarekebishwa hapa. Runtime probes si security certification ya endpoint.
5. **Response quality:** Empty/partial questionnaire response handling na deviation criteria completeness havijabadilishwa.
6. **Full verification:** Run isolated DB suite, repository TypeScript build na real authorized close/read-back kabla ya merge/deployment. UI/API lazima zionyeshe ended-but-active state bila kudai recovery.
7. **Source provenance:** Main ZIP ni sanitized export, si byte-identical Git checkout. Git apply-check inapaswa kufanywa kwenye target halisi; ikifeli, usitumie force au full-file overwrite.

## 6. Files na delivery

Patch inabadilisha source files tatu tu:

- `services/followup/src/workers/scheduler.worker.ts` — behaviour fix.
- `services/followup/src/services/checkin.service.ts` — documentation comment only.
- `services/followup/src/tests/followup.test.ts` — DB regressions and safe test-target guard.

Package ina patch, revised source copies, executable source-level probes, before/after TAP evidence, README na SHA-256 manifest. Hakuna DB dump, `.env`, token, OTP, real clinical data au full project duplicate.

ChangeSet 001 na 002 zinagusa paths tofauti. Combined working candidate ilipita earlier ownership probes 9/9. Package hii **haijumuishi patch ya 001 tena**.

**Hakuna commit, push, deployment, live DB mutation au Git history rewrite iliyofanyika.** Git commands za patch verification zilitumika kwenye disposable scratch copy pekee, si repository ya mtumiaji.
