# AHP — Uthibitishaji wa pamoja wa Safety Fixes 001 na 002

**Tarehe:** 20 Oktoba 2026  
**Hali:** Candidate na verification tooling; hakuna production approval.  
**Baseline iliyoripotiwa na archive:** `901dc9366f2eeb524fb04329eb95e7576e60201b`.

## 1. Kilichofanyika

Nimetengeneza candidate moja ya ndani kutoka kwenye ZIP iliyopakiwa, kisha nikatumia source files nne za ChangeSets 001 na 002. Original ZIP na archives za Premium UI/Demo hazijabadilishwa wala kuunganishwa. Hakuna Git remote iliyofunguliwa au kubadilishwa.

ChangeSet 001 inalinda ulinganifu wa patient na care thread. ChangeSet 002 inaondoa automatic `recovered` inayotokana na kuisha kwa muda wa follow-up. Pass hii haiongezi clinical rule, treatment, billing au UI feature.

Nimeongeza test-only database regression ya consultation pamoja na runner wa verification. Lengo ni kutofautisha wazi unit evidence, test-tool evidence na real database integration, badala ya kujumlisha kila kitu kama backend acceptance.

## 2. Matokeo yaliyotekelezwa katika pass hii

| Kazi | Matokeo | Ushahidi halisi |
|---|---:|---|
| ChangeSet 001 kwenye combined candidate | 9/9 PASS | Actual service source, in-memory dependency doubles |
| ChangeSet 002 scheduler/outcome cases | 22/22 PASS | Actual source, dependencies za majaribio |
| Existing Follow-up test-target guard | 17/17 PASS | Env/server-metadata probes; si DB halisi |
| Guard mpya ya database target | 41/41 PASS | Pure functions: env, URL, port, ownership metadata |
| Runner self-tests | 23/23 PASS | Modes, fingerprints, TAP result classification na redaction |
| Runner `--check` na `--run` katika mazingira haya | BLOCKED kwa usahihi | Dependencies hazipo; DB na tests hazikuanza |
| Patch apply/reverse-check | PASS | Nakala ya majaribio; source hashes zinalingana |
| Strict type-check ya pure guard na syntax ya test mpya | PASS | Global TypeScript 5.8.3; si full project build |

Hivi ni **vipimo 48 vya source/guard za fixes za awali na vipimo 64 vya verification tools mpya**, si vipimo 112 vya real backend integration.

## 3. Kizuizi cha mazingira kilichothibitishwa

Mazingira haya yana Node 22.16.0 na TypeScript ya global 5.8.3. `pnpm`, PostgreSQL executables, Docker na repository `node_modules` hazipo. Jaribio la kufikia `registry.npmjs.org` lilirudi na curl exit code 6 — DNS resolution failure.

Repository inaonyesha pnpm 10.34.4; lockfile ina TypeScript 5.9.3, tsx 4.23.5 na Prisma Client 6.19.3. Sijabadilisha versions, lockfile au kutumia global compiler kudai full build ya project.

**Hazijaendeshwa:** real PostgreSQL integration, migrations, full Consultation/Follow-up builds, HTTP/JWT/OTP acceptance, Staff Web, Flutter/device E2E na load tests. Hakuna database connection iliyofunguliwa na hakuna ledger `VALID` inayodaiwa katika pass hii. Kizuizi hiki ni cha runtime ya hapa, si ushahidi kwamba database ya mtumiaji imeharibika.

## 4. Vipimo vipya vya database vilivyoandaliwa

Faili mbili mpya, zote za tests:

- `services/consultation/src/tests/safety-test-target.ts`
- `services/consultation/src/tests/thread-integrity.test.ts`

Database suite ina cases tisa: foreign open thread, foreign closed thread, dependent mismatch chini ya guardian mmoja, admin mismatch, own-thread creation, owned-thread reopen, guardian/correct-dependant success, missing-thread rejection, na selected-patient ownership rejection.

Denial assertions zinakagua thread ibaki ilivyokuwa, consultation count isiongezeke, na success change/audit records zisiongezeke. Success cases zinakagua read-back ya patient/thread relationship na existing success audit. Hizi zimeandaliwa kutumia Prisma na actual service function; **hazijahesabiwa kama PASS kwa sababu DB haikuwepo**.

Suite haibadili Auth, haijengi OTP bypass, na haitangazi kuwa staff role policy yote imehakikiwa. Actor-scope finding AHP-002 kwenye audit ya awali bado inahitaji uamuzi na HTTP-level verification yake.

## 5. Runner salama

`verification/verify-safety.cjs` ina modes mbili:

- `--check`: source fingerprints, lockfile na local pinned-dependency checks pekee; hakuna DB access.
- `--run`: baada ya prerequisites kupita, hufanya read-only DB verification, scoped service type-checks, suites mfululizo na existing ledger verification.

Hai-install packages, haianzi/haisimi DB, haifanyi migrations, reset, truncate, Git staging, commit au deployment.

Kabla ya fixture writes, inahitaji `NODE_ENV=test`, operator acknowledgement ya disposable database, `ahealth_test` ya loopback kwenye explicit non-5432 port, DB ownership/server metadata inayolingana na initial business tables zilizo tupu. URL options zinazoweza kubadilisha host/port/database zinakataliwa. Hivi ni guardrails, si ushahidi huru wa kwamba DB ina data synthetic tu; operator lazima achague environment yake ya majaribio.

Database suite mpya huachwa mwisho na huhifadhi synthetic rows kwa review. Audit rows hazifutwi. Rerun inahitaji empty disposable target mpya badala ya script kufuta data yenyewe. Hakuna jina la database au port moja linaloruhusu kugusa mazingira mengine.

Skipped tests, zero tests, missing TAP summaries, errors na timeouts haziwezi kutafsiriwa kama integration PASS. Results na sanitized stdout/stderr huwekwa katika `.local` iliyopuuzwa na Git. Logs bado zinahitaji review kabla ya kusambazwa; regex redaction si PHI certification.

## 6. Mipaka ya source change

Verification pack inaongeza tests tu. Runtime source inabaki candidate ya fixes 001 na 002 iliyotolewa awali. Hakuna Prisma migration, enum, HTTP contract, JWT/OTP rule, UI, Flutter, prescription schedule, medication adherence, family package au clinical routing iliyobadilishwa hapa.

Runner fingerprints zinafanya matching ya faili zinazohusika na lockfile, si proof ya kwamba repository nzima imepitia build au security audit. New DB tests hazijapitia project-wide generated Prisma type-check kwa sababu dependencies hazipo.

## 7. Deliverable

`AHP_Verification_003_Combined_Safety_Gate.zip` ina:

- Patch inayoongeza test files mbili tu.
- Source ya test files kwa review.
- Runner wa portable Node, DB read-only probe na requirements manifest.
- Regression scripts za offline na raw TAP evidence iliyosafishwa.
- README yenye prerequisites, commands, failure behavior na verification limits.
- SHA-256 per-file manifest.

Hii **si project nyingine nzima**, na haipaswi ku-copywa kiholela juu ya `Final`. Apply previous fixes na test-only patch kwenye review checkout baada ya kusoma README; source mismatch ikitokea, simama kwa review.

## 8. Hatua za engineering zinazobaki

Kabla ya merge/release: full locked-toolchain build, real isolated PostgreSQL regression na legitimate HTTP/JWT acceptance. Baada ya hapo, digital front desk na workflow improvements zinaweza kuendelezwa kwa evidence yenye nguvu zaidi.

Follow-up review backlog, concurrent scheduling, calendar-day/timezone policy na explicit-close audit semantics bado ni findings tofauti; packet hii haidai kuzirekebisha.

**Hitimisho:** fixes mbili zinaendelea kupita scoped offline regression pamoja. Uthibitishaji wa real database bado ni NOT RUN; hakuna dai la production readiness.
