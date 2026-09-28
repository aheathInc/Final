# Operations console — A-health

The console dispatchers, facility administrators and platform administrators
work from: emergency dispatch, facilities, devices, incident reports, payments
and clinician verification.

Built against the real OpenAPI contract in `packages/api`. Every call goes to
an endpoint that exists.

## Running it

```bash
cp .env.local.example .env.local
openssl rand -base64 32          # put this in NEXTAUTH_SECRET
pnpm install
pnpm --filter admin-console dev
```

Then http://localhost:3200

Sign in with an account whose role is `platform_admin` or `dispatcher`. The
clinician seed account will authenticate but most screens will refuse it,
because the backend scopes these endpoints by role rather than by page.

## Screens

| Route | What it does |
|---|---|
| `/emergency` | Live dispatch board, 10s refresh |
| `/emergency/[id]` | Assign a unit and destination, move status |
| `/verification` | Approve or reject clinician licences |
| `/facilities` | Facility directory, departments, queue status |
| `/devices` | Register, monitor and revoke wearables and vehicle sensors |
| `/incidents` | Incident reports, escalated ones first |
| `/payments` | Settled payments and refunds |
| `/settings` | Account |

## Two rules worth knowing before changing anything

**`dispatched` is not a status you can select.** It is reachable only through
the dispatch action, which requires a real transport unit and a real
destination. A dropdown that could set it would let the board claim a crew is
on the way when nothing was assigned — a false state more dangerous than no
state at all. `lib/emergency.ts` encodes this, mirroring the backend.

**Colour carries operational meaning only.** A mass-casualty event takes the
strongest accent regardless of how far along it is; unhandled reports take
amber; resolved and cancelled ones lose their accent entirely. Nothing is
coloured for decoration, so a coloured row always means something.

## Things this deliberately does not do

- **Facility queue counts are always empty.** No facility sends a live queue
  feed at any integration level yet. The screen says that in words rather than
  rendering an empty table that reads as "nobody is waiting".
- **Anonymous incident reports show no reporter, anywhere.** The id was never
  written to the row — not even to the audit trail — so there is nothing to
  reveal and no screen that could.
- **A device credential is shown once.** A secret that can raise an emergency
  is not worth keeping recoverable; losing it means re-registering.
