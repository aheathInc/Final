# Clinician console — A-health

The web console a doctor or nurse works from: the live queue, the case they
accepted, closing it, and the reference screens around that.

Built against the real OpenAPI contract in `packages/api`. Every call goes to
an endpoint that exists; nothing here invents a route.

## Running it

```bash
cp .env.local.example .env.local
openssl rand -base64 32          # put this in NEXTAUTH_SECRET
pnpm install
pnpm --filter doctor-dashboard dev
```

Then http://localhost:3100

Three services must be running for the queue to work: `auth` (4001),
`consultation` (4005), `doctor` (4003). Others are only needed by the screens
that use them.

## How requests reach the backend

The browser never calls the twenty-odd services directly. Everything goes to
this app's own `/bff/*` route handler, which looks up which service owns the
path and forwards with the session token attached server-side.

Two reasons, both deliberate:

- Twenty-odd origins would mean twenty-odd CORS configurations to keep in
  step, and one mistake among them is a hole.
- The token lives in next-auth's httpOnly cookie, which page JavaScript
  cannot read. On an app holding clinical records, a token in `localStorage`
  is one XSS away from being someone's medical history.

`lib/services.ts` is the path→service table. It is a **stopgap**: the SA&D
specifies a real API Gateway (Kong) doing this routing plus rate limiting.
Set `API_GATEWAY_URL` and every lookup collapses to that one origin.

The proxy is at `/bff` and not `/api` because next-auth owns
`/api/auth/[...nextauth]`, and Next resolves that more specific route first —
a catch-all at `/api/[...path]` would have every `/auth/*` call silently
swallowed.

## Design rule

**Colour carries clinical meaning and nothing else.** `clay` marks an
emergency, `amber` marks urgent, and a routine case gets no accent at all. A
clinician scanning twenty rows finds what cannot wait without reading a word.
Decorating every row would destroy exactly that signal, so there is no brand
colour applied for its own sake anywhere.

`urgency.ts` is the single place this is decided, so it cannot drift between
screens.

## Screens

| Route | What it does |
|---|---|
| `/queue` | Live queue, SLA countdown, accept / decline with a reason |
| `/case/[id]` | Accepted case: messages, referral, patient record |
| `/case/[id]/close` | Note, prescription and follow-up in one submit |
| `/appointments` | Scheduled appointments; start opens a consultation |
| `/slots` | Publish bookable slots |
| `/diagnostics` | Investigation orders; critical results first |
| `/diagnostics/[id]` | Results table, acknowledge receipt |
| `/follow-up` | Adherence logs, missed doses first |
| `/network` | Communities and case discussion |
| `/second-opinions` | Claim and answer specialist questions |
| `/assistant` | AI chat and drug interaction check |
| `/pharmacy` | Medication availability before prescribing |
| `/education` | Draft and publish patient-facing articles |
| `/families` | The family assigned to you |
| `/patients/[id]` | Risk scores, vaccinations, prescriptions |
| `/settings` | Availability and account |

## Things this deliberately does not do

- **No earnings, dashboard statistics or performance screens.** There is no
  endpoint for any of them in the contract. Building a page against an
  invented route is how the previous `lib/api-client.ts` ended up calling
  `/doctors/{id}/earnings`, which does not exist anywhere.
- **The queue polls every 15 seconds rather than using websockets.** Messaging
  has a realtime channel; the queue does not. Polling is honest about that.
- **A patient's name and date of birth are not shown before acceptance.** The
  contract permits an age band only, and the queue card says so out loud so
  the sparseness does not read as missing data.

## What replaced the previous scaffold

The earlier files under `app/dashboard`, `app/consultations`, `app/earnings`
and `lib/api-client.ts` called `/doctors/*` routes that exist nowhere in the
contract, and read the session token from `localStorage`. They are gone. The
working equivalents are `/queue`, `/case/[id]` and `/appointments`.
