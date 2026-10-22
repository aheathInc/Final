# AHP — Ripoti ya Kazi na Cumulative Candidate 004

**Tarehe ya handoff:** 21 Oktoba 2026. Evidence files zina timestamps halisi za runtime (UTC).
**Hali:** `REVIEW CANDIDATE — NOT RELEASE APPROVED`.
**Msingi:** sanitized source export iliyoripoti commit `901dc9366f2eeb524fb04329eb95e7576e60201b`.
**GitHub:** haikufunguliwa au kubadilishwa katika pass hii. Hakuna commit, push, migration au deployment.

## 1. Jibu la msingi

Nimekusanya source ya Web, backend na Flutter kwenye folder moja la `Final`, nikijumuisha fixes 001/002, DB verification tests 003 na marekebisho mapya ya pass hii. Hii ni candidate ya code review na integration testing, **si uthibitisho kwamba kila functionality ya AHP imekamilika au inafanya kazi hospitalini**.

Archives zote sita zilizosomwa zimepita ZIP CRC na ukaguzi wa path; checksums za archives tatu za project zinalingana na handoff. Original ZIPs hazijabadilishwa. Baseline yenyewe ilikuwa sanitized export: baadhi ya local database URL values zilibadilishwa na mtengenezaji wa archive kabla haijapakiwa. Kwa hiyo candidate hii si Git checkout inayolingana byte-for-byte na commit ya remote.

## 2. Marekebisho ya runtime yaliyomo

### 2.1 Patient/thread consistency — fix 001 imehifadhiwa

`services/consultation/src/services/consultation.service.ts` inakataa kuunganisha consultation na care thread ya mgonjwa tofauti kabla ya kuifungua tena thread au kuandika consultation.

Service regression ya source halisi kwa in-memory collaborators: **9/9 PASS**. Hii haimalizi swali tofauti la ni staff roles gani zina ruhusa ya kuanzisha consultation kwa ni mgonjwa gani (AHP-002 kwenye initial audit).

### 2.2 Follow-up haidai recovery kutokana na muda — fix 002 imehifadhiwa

`services/followup/src/workers/scheduler.worker.ts` haiweki `recovered` kwa sababu muda umeisha na deviation count ni sifuri. Expired cycles zinabaki kwa explicit review/closure. Scheduler haibadili medication `unreported` kuwa `missed`.

Existing outcome/scheduler behavioural tests: **22/22 PASS**. Closure policy ya clinician/admin iliyopo haijapanuliwa. Hakuna status mpya, migration, medical threshold au treatment schedule iliyoongezwa.

### 2.3 Single-writer check-in responses — fix mpya

Katika `checkin.service.ts`, baseline ilisoma `scheduled`, kisha ikaandika jibu bila conditional write. Requests mbili zingeweza kupita pre-check hiyo pamoja, kubadilisha row mara mbili na kuongeza deviation counter mara mbili. Candidate inatumia conditional `updateMany` ya row ileile ikiwa status bado ni `scheduled` au `missed`; request moja ikishafanikiwa, nyingine inapata existing `CHECK_IN_ALREADY_ANSWERED` / 409.

Response inachukua PostgreSQL cycle row lock kabla ya kubadili check-in, ikifuata cycle → check-in lock order inayotumiwa na closure. Hii inalenga kuzuia cyclic row-lock waits kati ya hizo operations; DB test yake bado NOT RUN.

Late responses za check-in iliyokuwa `missed` bado zinaruhusiwa kama awali. First successful response haiwezi kuandikwa upya na concurrent request. Audit inayohitajika kwa deviation inapokea **transaction ileile**, badala ya kuandikwa baada ya response/counter kucommit.

### 2.4 Explicit closure na audit ni operation moja — fix mpya

`closeCycle` sasa inafanya conditional transition kutoka `active` kwenda `completed`. Concurrent closure haiwezi kubadilisha outcome iliyoshahifadhiwa na request nyingine. Cycle update, care-thread pointer, existing check-in updates na closure audit ziko transaction moja. Failure ya required audit inapaswa kurudisha writes zote nyuma.

`maxWait` na transaction `timeout` zina mipaka ya milliseconds 10,000 kila moja. Hizo ni bounds mbili tofauti, **si ahadi kwamba request nzima haiwezi kuzidi sekunde 10**. Hakuna external network call iliyoongezwa ndani ya transaction.

Mipaka: majaribio ya rollback yaliyotekelezwa hapa yanatumia transaction double. PostgreSQL lock behaviour na real database rollback bado zinahitaji DB suite. Closure bado inatumia existing outcome choices na existing scheduled-check-in marking; pass hii haijabuni sera mpya ya kliniki.

### 2.5 Kupunguza taarifa za kliniki kwenye deviation audit — fix mpya

Maelezo ya deviation na responses yanabaki kwenye protected CheckIn record. New `checkin.deviation_flagged` audit metadata sasa ina `cycleId` na `reasonCount`, si numerical responses/free-text reasons. Existing audit rows hazijaandikwa upya. Hili si dai kwamba kila audit event au log kwenye repository imepita PHI review; explicit closure `notes` behaviour iliyokuwepo imehifadhiwa.

### 2.6 Staff role home routing — fix ndogo iliyochaguliwa kutoka demo review

`apps/staff-web/lib/roles.ts` ilikuwa haina `pharmacist` wakati middleware na Pharmacy page tayari zinaitambua. Nimeongeza mapping ya `/pharmacy` na kufanya unknown/inherited object keys ziangukie `/login`.

Hii inasawazisha helper na supported route; **siyo dai kwamba pharmacist login ya production ilivunjika kila wakati**, kwa sababu middleware yenyewe tayari ilikuwa na mapping sahihi. Permission lists, Auth, cookies na middleware hazijabadilishwa. Tests za resolver/requireRole kwa session doubles: **18/18 PASS**, dhidi ya baseline **13 PASS / 5 FAIL**. Hizi si real NextAuth login tests.

## 3. Marekebisho ya portability

Archive ilikuwa na scripts 70 za Bash zenye CRLF. Direct `bash -n` ilishindwa kwa 69 kati ya 70 katika Linux hii. Jaribio lilelile baada ya kubadilisha CRLF kwenda LF pekee lilipita **70/70**.

Nimenormalize scripts zote 70 kwenye candidate na kuongeza `.gitattributes` yenye `*.sh text eol=lf`. **Hakuna maandishi ya command yaliyobadilishwa na normalization**, na hakuna seed/setup script iliyoendeshwa. Validation hii ni syntax pekee, si approval ya kuendesha historical `setup-*`/`fix-*` scripts: baadhi huandika source au schema, na hazipaswi kuitwa kiholela kwenye project ya sasa.

Original archive bytes zimehifadhiwa. `shell-normalization.json` ina before/after checksums kwa kila script.

## 4. Majaribio halisi ya pass hii

| Eneo | Matokeo | Aina ya ushahidi |
|---|---:|---|
| Consultation thread consistency | 9/9 | Actual source + in-memory doubles |
| Follow-up scheduler/outcome | 22/22 | Actual source + in-memory doubles |
| Follow-up response/closure integrity mpya | 26/26 | Actual source + row-lock/rollback simulation |
| Staff home/role helper | 18/18 | Actual source + session/redirect doubles |
| Existing Auth configuration suite | 8/8 | Unmodified source + existing pure tests; hakuna DB |
| Follow-up test-target guard | 17/17 | Pure guard tests |
| Shared isolated-DB guard | 41/41 | Guard inputs/server-metadata doubles |
| Verification runner self-tests | 23/23 | Tool behaviour, sio product tests |
| TypeScript/TSX parsing | 503/503 | Syntax parser; si full type-check/build |
| JSON parsing | 106/106 kwenye final static scan | Parsing; si schema validation |
| Bash syntax after normalization | 70/70 | `bash -n` pekee |

Node test run ya verification directory ina **156 PASS / 0 FAIL / 0 SKIP**; existing Auth pure suite iliendeshwa kando ikiwa **8/8**. **Sijaziita tests 164 za backend E2E**: sehemu yake ni tools/guard tests, na hakuna inayoendesha deployment nzima.

Regression mpya ya follow-up ilipata **15 PASS / 11 FAIL** dhidi ya source ya awali, kisha **26 PASS / 0 FAIL** dhidi ya candidate. Failures zilijumuisha double response/deviation count, concurrent closure, audit kuandikwa nje ya transaction, rollback baada ya audit failure na clinical values kwenye metadata.

Nimeongeza pia **DB regression cases 6** ndani ya existing Follow-up suite. Hizo **NOT RUN** hapa. Verification Pack 003 DB cases pia hazijahesabiwa kama PASS.

## 5. Full-system verification ambayo haikufanyika

Mazingira yana Node `22.16.0` na global TypeScript `5.8.3`. Project inahitaji pnpm `10.34.4`, locked TypeScript `5.9.3`, tsx `4.23.5` na Prisma Client `6.19.3`. Tooling/dependencies hizo hazipo kwenye workspace. PostgreSQL, Docker, Flutter na Dart pia hazipo.

Registry probe ya npm ilirudi `curl` exit code **6 (DNS failure)**. Sikubadilisha package versions, lockfile au security restrictions ili kupita hili. Pinned integration preflight ilisimama `BLOCKED` kabla ya kuunganisha database.

**NOT RUN:** pnpm locked install/full builds; generated Prisma type-check; migrations; real PostgreSQL transactions; Auth OTP/JWT/refresh integration; Staff Web browser E2E; Flutter tests/analyze/device E2E; Docker startup; external AI/SMS/payment/hospital integrations; performance/load/security certification.

Vipimo vya code vya mwaka huu vilivyoripotiwa awali na agent vinabaki historical evidence; havijaitwa independent verification ya candidate hii.

## 6. Premium UI na Demo ziko wapi?

Zimehifadhiwa tofauti bila blanket overlay. Comparison manifests zinapatikana kwenye `docs/verification/`:

- Premium UI: source/context files **40**; 25 tofauti na baseline, 15 mpya. Owner visual approval bado ni requirement. Hakuna UI mockup iliyochukuliwa kuwa actual live acceptance.
- Demo: source files **21**; 10 tofauti na baseline, 11 mpya. Ina Auth local database allowlist, server host-binding, seed na lifecycle scripts. Patch iliyoredactiwa inahitaji manual reconciliation kama handoff ilivyosema.

Fix moja ndogo iliyokaguliwa imetolewa kutoka demo intent: pharmacist home mapping. Source ya demo/Auth/bootstrap haijachanganywa kwa ujumla. Hii ndiyo sababu candidate bado **si completion ya Premium UI/Demo**.

## 7. Kile bado kinahitaji kukamilishwa kwa vision ya AHP

Source audit ya awali ina file/line references za mapengo haya. Hayajafichwa na test counts:

- **Patient entry/reception:** facility-aware queue, hospital check-in, verified insurance eligibility na approved pricing/payment orchestration bado havijathibitishwa kama journey moja.
- **Symptom routing:** free-text kama tatizo la meno bado si validated department routing. Hakuna clinical rules mpya zilizobuniwa katika pass hii.
- **Authorization:** creator-role/selected-patient policy kwenye consultation bado inahitaji explicit restriction/verification; guard ya thread pekee haitoshi kuitangaza endpoint yote kuwa salama.
- **Follow-up:** reminder producer/delivery/acknowledgement, multi-worker scheduler deduplication, time-zone/calendar-day policy na clinician review backlog bado zinahitaji implementation/review.
- **Diagnostics:** partner-hospital lab order/result handoff bado haiwezi kudaiwa kutokana na endpoints zilizopo pekee.
- **Family packages:** tier na doctor assignment si proof ya paid subscription/renewal/benefits.
- **External services:** AI ni local/stub, payments/SMS/USSD na hospital integrations hazijathibitishwa kama real providers hapa.
- **UI/UX:** approved Hybrid A+C direction ipo kwenye pending archive, lakini full visual/functional merge bado haijafanywa.

Haya ni engineering/governance decisions zinazobaki. Hakuna tariff, diagnosis, dawa, hospital agreement au deployment policy niliyobuni ili kuandika “complete”.

## 8. Faili moja ya kuanzia, si patch stack ya kubahatisha

`AHP_Integrated_Candidate_004.zip` ina root moja la `Final/`, complete sanitized baseline, scoped fixes na verification source/evidence. Extract kwenye **folder jipya la review**; usi-overwrite checkout yako au kunakili `.env`/DB kutoka worktrees nyingine.

`README.md` na `CANDIDATE.json` ndizo maelezo ya candidate hii. `SOURCE-COMMIT.txt` na `AHP-HANDOVER.md` zilizohifadhiwa ni metadata ya **input baseline**, si dai kwamba changes mpya ziko GitHub. `SHA256SUMS.txt` mpya inahusu candidate yote; manifest ya baseline imehifadhiwa tofauti.

Source patch ndani ya `verification/patches/` ina logical code changes; `shell-normalization.json` inarekodi line-ending-only conversion tofauti. Checksums za ZIP hutolewa kwenye sidecar, si ndani ya archive yenyewe, ili kuepuka circular hash.

## 9. Uamuzi wa sasa

**CANDIDATE PREPARED; SCOPED REGRESSIONS PASS; FULL SYSTEM/DB/WEB/MOBILE ACCEPTANCE NOT YET VERIFIED.**

Hakuna release/tag/remote change. Hakuna DB ya mtumiaji, PostgreSQL 5432, container, worktree ya Windows au production resource iliyoguswa. Source za awali zimehifadhiwa.

### Marejeo ya kiufundi tofauti na source findings

Database conditional-write/transaction intent inafuata documented PostgreSQL row-write semantics; rollback ya database yenyewe bado haijajaribiwa hapa. Official background: PostgreSQL 17 documentation, “Explicit Locking” na “Transactions”. Authorization per-object remains a separate requirement; background: OWASP API1:2023, “Broken Object Level Authorization”. Evidence ya implementation ni files/TAP zilizo kwenye package, si references hizi peke yake. Hakuna mabadiliko ya version kwenda Prisma ya documentation mpya yaliyofanywa.
