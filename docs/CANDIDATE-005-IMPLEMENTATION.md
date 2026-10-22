# AHP — Implementation 005: Digital Front Desk

**Tarehe:** 21 Oktoba 2026  
**Hali:** Source implementation imeandikwa; scoped regression PASS; full runtime/E2E bado NOT RUN.  
**Parent:** Integrated Candidate 004.  
**Main iliyotajwa kwenye source ya input:** `901dc9366f2eeb524fb04329eb95e7576e60201b`. Hii si SHA ya commit mpya.

## 1. Kazi mpya iliyofanyika sasa

Nimeongeza vertical slice ya Digital Front Desk kwenye backend, Flutter na Staff Web. Hii si
report au safety patch pekee. Ina code mpya ya kutengeneza visit/ticket, kutenganisha foleni
kwa hospitali na idara, kurekodi administrative review na clinician assessment, kumwita mgonjwa,
kuanzisha consultation iliyopo na kufunga visit baada ya consultation kukamilika.

| Eneo | Source implementation |
|---|---|
| Patient Mobile | Home → **Huduma hospitalini**, fomu ya ziara mpya, orodha ya ziara, check-in, status/queue position, cancel na consultation/chat link |
| Admin Web | `/admin/front-desk`: kuwezesha facility, kuweka masharti ya ukaguzi, directory aliases na kuthibitisha manual administrative checks |
| Doctor Web | `/doctor/front-desk`: intake ya department yake, kuandika clinical queue clearance/escalation, call patient, start consultation |
| Backend | Moduli mpya ndani ya Consultation service; operations 16 chini ya `/front-desk` |
| Database | `FrontDeskVisit`, state enums, readiness constraints, partial unique indexes, facility opt-in na department aliases |
| Existing care | Visit inaunda care thread na consultation kwa patient sahihi; existing signed completion hufunga visit ileile |
| Contract | OpenAPI paths 15 na schemas 21 za feature hii; routes zimeunganishwa kwenye BFF na Flutter config |

### Safari mpya iliyoandikwa

Patient login iliyopo → chagua hospitali → eleza huduma → chagua department → chagua doctor
anayepatikana au department pool → pre-register → pata AHP ticket → thibitisha kufika →
admin records manual clearance + clinician records actual assessment → waiting → called →
consultation starts → existing consultation completion → visit completed.

Clinical review inaweza kurekodiwa kabla ya arrival ikiwa kweli imefanywa na clinician;
foleni ya routine haifunguki mpaka arrival na checks zote zikamilike. Hakuna algorithm
inayosema kwamba patient yuko salama. Urgent-help request haitengenezi ordinary ticket.

## 2. Department navigation — kile kilichoandikwa, si madai ya AI

Admin anaweza kusanidi majina/maneno yanayotumika kwa department iliyopo. Mfano wa development:
`meno`, `jino`, `tooth` kwa idara halisi ya huduma hiyo. Mgonjwa akiandika neno linalolingana,
UI huonyesha pendekezo la directory na mgonjwa ndiye anathibitisha department.

Hii ni **configured directory matching**, si model ya AI, diagnosis au clinical triage. Hakuna
clinical code/specialty mpya iliyobuniwa wala maandishi kutumwa kwa external model. Kutopata
match kunasababisha manual selection, si general-practice fallback iliyofichwa.

## 3. Foleni na usalama wa taarifa

Foleni ni ya AHP registrations pekee. Haijui walk-ins wa hospitali nyingine wala queue nzima ya
partner hospital bila integration. Doctor counts na availability zinatokana na records za AHP;
ETA haibuniwi. Patient position imetenganishwa kwa facility, department na requested doctor/pool.

Patient B hawezi kusoma/kucheck-in/ku-cancel visit ya A. Clinician asiyeverified, aliye inactive
au wa department/facility nyingine hawezi kuandika hatua za clinical queue. Platform admin ana
administrative projection bila purpose ya kliniki. Intake sharing ni idhini ya ombi la huduma
kwa department iliyochaguliwa, si ruhusa ya kuonyesha full patient history.

Request key ya creation hutengenezwa mara moja na kuhifadhiwa pamoja na visit. Retry ya ombi
lilelile hairudishi ticket mpya. Action writes zinahitaji version iliyosomwa; old version
inakataliwa badala ya kubadili state mara mbili. Stock/pharmacy, referral, FHIR na existing
clinical authorization hazijapewa bypass.

Locks na DB constraints zimeandikwa kwa concurrent creation/call/start; full PostgreSQL
verification ya locks hizo bado haijaendeshwa hapa. Audit ya writes mpya inashiriki transaction,
na haihifadhi symptom text au payment/insurance reference contents kwenye metadata.

## 4. Malipo na bima: mipaka ya sasa

**Sijaunganisha mobile money, benki au insurer. Sijaweka registration fee ya kubuniwa.**
Admin anaandika ukaguzi uliofanywa na facility, si successful provider response ya bandia.
Facility policy ina opt-in na masharti ya manual review; default mpya ni disabled.

Hii ndiyo sehemu ya kuunganisha provider halisi baadaye, lakini vigezo na UI havidai automated
payment/coverage verification. Receptionist/facility-admin membership model ya production
pia bado inahitaji implementation/approval; sasa administrative writes ni platform_admin tu.

## 5. Client state na user experience

Flutter ina loading, error, empty, retry na persisted status tofauti. Hakuna offline queue ya
check-in/registration, hakuna SOS inayotumwa yenyewe. Patient hutakiwa kuthibitisha arrival na
cancellation. Kuondoka kwenye account hufuta state ya screen, request key na old selections;
owner/generation checks zinakataa late responses. Session refresh bila identity mpya si switch.

Visit status poll ina kikomo: kila sekunde 15, mpaka ticks 20, screen ikiwa foreground/current
pekee. Manual refresh ipo. Hii si WebSocket, push notification au background monitoring.
Staff Web imetumia components na palette zilizopo kwenye source kuu. **Pending Premium UI
haijaingizwa na sikudai visual approval ya UI mpya.**

## 6. Verification iliyotekelezwa hapa

| Ukaguzi | Matokeo | Kiwango cha ushahidi |
|---|---:|---|
| New front-desk domain + service tests | 67/67 PASS | Service source halisi, Prisma/audit dependency doubles za in-memory |
| BFF service path routing mpya | 7/7 PASS | Resolver function halisi, si HTTP session |
| Previous Candidate 004 regression/tool tests | 156/156 PASS | Safety code na verification helpers; si full backend suite |
| Combined offline suite | 230/230 PASS | Hakuna failed/skipped tests kwenye suite hii |
| TypeScript/TSX syntax | 513 files, 0 syntax errors | Parser ya global TypeScript 5.8.3; si locked-toolchain project build |
| Pure domain + Staff DTO strict types | PASS | Files mbili zisizohitaji generated Prisma/React deps |
| OpenAPI YAML/local refs/route parity | PASS | Operations 16 zinaendana na source; si Redocly semantic lint |
| Existing migrations + lockfiles | PRESERVED | Migrations 20 za awali na lockfiles zina byte contents zilezile |

Evidence inayoweza kukaguliwa iko `docs/verification/005/` ndani ya ZIP. Test doubles
zinasimulate serial transactions na rollback. **Hazithibitishi PostgreSQL concurrency, SQL
constraint execution, JWT, device, browser au external payment behavior.**

## 7. Tests zilizoandikwa lakini HAZIJAENDESHWA

- **12 real-PostgreSQL regression cases** kwenye `front-desk.database.test.ts`, zenye database
  identity/owner/loopback/non-5432 safeguards na explicit isolated DB acknowledgment.
- **15 Flutter tests** za parser, UUID, offline refusal, retries, loading/error/empty states,
  logout na delayed responses.
- **2 Playwright real-login smoke tests** za Doctor/Admin route/BFF, opt-in kwa isolated runtime.
- Prisma validate/generate, new migration application, semantic OpenAPI lint na generator,
  full Consultation/Staff Web builds, Flutter analyzer/full suite na integrated manual journey.

Mazingira haya hayana pnpm/repository dependencies, PostgreSQL, Flutter/Dart au browser runtime
ya AHP. Jaribio la npm registry lilishindwa kwa DNS. Sijabadili lockfiles kuficha kizuizi hiki.
**Generated OpenAPI TypeScript output bado inahitaji regeneration kabla ya integration.**
New UI inatumia explicit local DTOs; package haisemi generator imepita.

## 8. Original source na mabadiliko yaliyohifadhiwa

Candidate 005 ni project kamili yenye folder moja `Final/`, juu ya Candidate 004. Ina fixes
001–004 zilizokuwapo na implementation hii mpya. Hakuna original source archive, pending UI
archive au Demo archive iliyobadilishwa. Hakuna GitHub commit/push, deployment, database
connection au mabadiliko ya Windows PostgreSQL 5432 yaliyofanyika.

Migrations sasa ni **21 zilizopo kwenye source**, si 21 zilizotumika hapa. Mpya ni
`20261021090000_digital_front_desk`. Current source haijafanyi auto-enable ya hospitali.
Extraction ya ZIP haiwashi service, seed au migration.

## 9. Mahitaji yako ambayo bado hayajamalizwa na pass hii

Hii ndiyo implementation ya kwanza ya digital hospital intake/queue. Haijakamilisha:
real payment/insurance eligibility integrations; AI ya clinical routing iliyothibitishwa;
full hospital queue synchronization; automated reminders/SMS delivery; family subscription
billing/benefits; partner-lab adapters; research-governance portal; pre-start clinician chat;
USSD front desk; production facility receptionist access; Premium UI modernization.

Existing Phase A–D code ipo kama ilivyorithiwa; sijaidai nimeijenga upya au nimeirudia E2E yote.

## 10. Jinsi ya kutumia deliverable

Extract ZIP kwenye **folder tofauti la review**, usi-overwrite project yako inayotumika.
Fungua `README.md`, kisha `docs/DIGITAL-FRONT-DESK.md` kwa commands, endpoint contracts,
manual acceptance journey na migration safety. Private env files na identities halali zitatoka
kwenye approved isolated local setup, si kutoka kwenye package hii.

**Uamuzi wa pass hii:** functionality mpya imeandikwa na scoped source tests zimepita.
**Live acceptance na release approval bado zinasubiri; hii si “kila kitu cha mfumo kimekamilika.”**
