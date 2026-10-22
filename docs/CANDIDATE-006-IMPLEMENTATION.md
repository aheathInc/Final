# AHP Candidate 006 — Care Continuity

Tarehe: 21 Oktoba 2026. Hii ni implementation mpya juu ya Digital Front Desk ya Candidate 005. Si tangazo la production readiness wala kwamba functionality zote za AHP zimekamilika.

## Kilichoandikwa kwenye product

**Doctor Web:** `/doctor/follow-up` ina worklist ya wagonjwa anaowafuatilia, check-in review, ratiba za dawa na mawasiliano yaliyopangwa. `/doctor/follow-up/medication-times` ina signed prescriptions za prescriber huyo, hata kama hakuna follow-up cycle. Daktari anaweka tarehe ya kuanza, timezone na muda wa kila dozi; frequency, duration na dosage havibadilishwi na reminder form.

**Patient Flutter:** Home → **Ufuatiliaji wangu**, yenye tabs Dawa, Follow-up na Vikumbusho. Mgonjwa anaweza kuthibitisha amemeza, ameruka au amechelewa. Kutokujibu kunabaki *haijathibitishwa*, si *hakumeza*. Pia anaona planned contacts, anafungua mazungumzo/check-in zilizopo na anaweza kuruhusu/kuzuia generic SMS reminders.

**Follow-up na Notification:** worker huandaa reminders za explicit schedules na check-ins zinazofaa, huzihifadhi kwa read-back, na huqueue generic SMS kwa opt-in. Leased dispatcher hupunguza duplicate work, hurecheck eligibility kabla ya send, na hutumia provider idempotency key. Console delivery ni simulated. Hakuna carrier delivery iliyofanyika hapa.

**Mawasiliano:** kupanga phone/chat contact na kuhifadhi outcome, pamoja na link ya existing care conversation. Phone link hufungua dialer; si in-app calling, call recording au uthibitisho kwamba simu ilipigwa.

**Usalama:** patient/guardian ownership, verified prescriber/assigned clinician checks, version conflicts, same-item locks, transaction pamoja na audit, owner/generation UI clearing, no-store responses. Hakuna auto-recovered kutoka silence, expired follow-up window au contact iliyowekwa completed.

## Product preview inayofunguka sasa

`demo-previews/AHP_Care_Continuity_Preview_006.html` ni HTML ya browser yenye components halisi za React/CSS zilizoandikwa, lakini API yake ni synthetic/in-memory iliyoandikwa wazi kama demo. Unaweza kufanya review, kuhifadhi schedule, pause, kupanga contact, kubadili appearance/density, account na error state. Preview si real Auth, Next server, DB, SMS, phone call au Flutter simulation. Pending Premium UI haijawekwa kwenye source kwa bulk.

## Majaribio yaliyofanyika

- Tests mpya za source functions/domain/workers zenye dependencies za majaribio: **78/78 PASS**.
- Regression za awali: **230/230 PASS**; combined **308 PASS, 0 FAIL, 0 SKIP**.
- Chromium actual-component preview: **checks 16 PASS**, page errors 0; viewports1440/1024/768/390 bila horizontal overflow; keyboard tabs na reduced-motion zimehakikiwa.
- TypeScript syntax parse: files513, errors0. Hii si full type-check/build. Pure schedule module strict check imepita kwa compiler ya global.
- OpenAPI YAML/1,045 local references/11 route operations: PASS. Codegen na semantic lint hazijaendeshwa.
- Lockfiles na migrations21 za Candidate005 hazijabadilika. Migration mpya moja imeandikwa, jumla22; haijatumika kwenye DB.
- Bash syntax70/70 PASS; hakuna script ya setup/seed iliyoendeshwa.

Evidence imehifadhiwa kwenye `docs/verification/006/`. Majaribio ya database mapya12 na Flutter12 yameandikwa lakini **NOT RUN**. Full Next/backend builds, Prisma, PostgreSQL concurrency, JWT/BFF E2E na Flutter/device acceptance bado hazijaendeshwa hapa kwa kukosekana kwa toolchain/dependencies. Integration runner imesimama salama kwa missing pinned dependencies kabla ya DB connection.

## Mipaka isiyofichwa

Hakuna actual mobile-money/bank/insurer, laboratory partner, carrier SMS, background phone alarm, in-app voice/video au family subscription implementation katika pass hii. Existing front desk ipo lakini si revalidated live. Clinical AI routing na research workflow expansion bado ni kazi zinazobaki. Hakuna claim ya all-functionality completion.

Reminders za SMS zinahitaji provider halali na opt-in. Provider acceptance si handset receipt. Process crash baada ya send inaweza kuhitaji retry: exactly-once inahitaji provider idempotency. Already-sent message haiwezi kurudishwa kwa pause. Check-in review/contact details bado zinahitaji clinical governance review kabla ya real data.

## Integration

Extract folder `Final/` sehemu tofauti, usi-overwrite active checkout. Fuata `CARE-CONTINUITY.md` kwa dependency install iliyofungwa, migration review, generate, isolated DB verification na test commands. Source delivery haija-commit, push, merge au deploy. Original archives zote zimehifadhiwa.
