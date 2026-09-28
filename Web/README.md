# A-health Platform

Backend for **A-health** — a proactive digital health platform for Tanzania, built to work where connectivity is unreliable and a smartphone cannot be assumed.

The system addresses five gaps identified in the *African Digital Health Ecosystem* blueprint: facility overburden, unemployed clinicians, the follow-up void, medication misuse, and late pathology discovery.

---

## Architecture at a glance

| | |
|---|---|
| **Services** | 25 independent Express services, one per domain |
| **API contract** | OpenAPI 3.1 — 111 paths, 127 schemas, 28 tags |
| **Database** | PostgreSQL 16 via Prisma — 70 models, 70 enums |
| **Runtime** | Node 22, TypeScript 5.9 (ESM), pnpm workspaces + Turborepo |

Every service is independently testable, owns its own routes, and shares a common kit (`packages/http`, `packages/logger`) rather than duplicating auth, error handling, pagination, or audit logic.

---

## Repository layout

```
packages/
  api/          OpenAPI contract + generated TypeScript types
  database/     Prisma schema, migrations, client singleton
  http/         Shared kit: auth guards, errors, audit chain, pagination, idempotency
  logger/       Zero-dependency structured JSON logger with PII redaction
  config/       Shared constants (service ports)

services/       25 services — see the table below
apps/           Frontend applications (separate track)
docs/           Blueprint, system analysis and design documents
```

---

## Services

### Care delivery
| Service | Port | Responsibility |
|---|---|---|
| `auth` | 4001 | Registration, OTP, login, refresh, password lifecycle |
| `patient` | 4002 | Patient profiles, dependants, consent grants |
| `doctor` | 4003 | Clinician verification, availability, bookable slots |
| `appointment` | 4004 | Scheduled entry route into a consultation |
| `consultation` | 4005 | Triage engine, clinician matching, SLA worker, care threads, queue |
| `messaging` | 4006 | Thread-scoped messaging with WebSocket delivery |
| `followup` | 4007 | Check-in cycles, deviation detection, adherence tracking |
| `notification` | 4008 | SMS/push delivery, Swahili-first templates |

### Clinical support
| Service | Port | Responsibility |
|---|---|---|
| `ai` | 4009 | Model registry, chat adapter, advisory triage suggestions |
| `emergency` | 4010 | Emergency reporting, ambulance dispatch, transport tracking |
| `pharmacy` | 4011 | Medication search, dispense codes, dispensing records |
| `payment` | 4012 | Mobile money (M-Pesa, Tigo Pesa, Airtel), card, cash, refunds |
| `diagnostics` | 4013 | Investigation orders, results, critical-value flagging |
| `devices` | 4023 | Wearables and vehicle sensors, telemetry, fall/collision alerts |
| `prevention` | 4024 | Risk scores, vaccinations, screening invitations |

### Platform and community
| Service | Port | Responsibility |
|---|---|---|
| `quality` | 4014 | Consultation ratings, incident reports |
| `families` | 4015 | One-family-one-doctor subscription (GP + OB/GYN) |
| `education` | 4016 | Multilingual health content, clinician-reviewed |
| `network` | 4017 | Professional communities, case discussion, second opinions |
| `insurance` | 4018 | Coverage checks, claims |
| `research` | 4019 | De-identified aggregate datasets, ethics-gated queries |
| `surveillance` | 4020 | Disease trend rollups, outbreak signal reporting |
| `facilities` | 4025 | Facility directory, departments, queue status |

### Access and sync
| Service | Port | Responsibility |
|---|---|---|
| `gateway` | 4021 | USSD and SMS bridge for non-smartphone access |
| `sync` | 4022 | Offline change feed and queued-write replay |

---

## Design principles

**One implementation of the business rules.** The USSD gateway and the offline sync replay both call the *same* authenticated endpoints the mobile app calls, over HTTP, with a real token. A channel never gets its own copy of the logic it would inevitably drift from.

**Server-computed clinical judgements.** Triage urgency, follow-up deviation flags, and critical lab-value flags are all computed server-side from versioned rules. A client never tells the server that its own result looks normal.

**Honest data over fabricated data.** Where a real data source is not yet wired — outbreak forecast bands, facility queue feeds, insurance facility-acceptance — the API returns `null` or an empty list and says so, rather than an estimate nobody measured.

**Audit without immutability lock-in.** An append-only, hash-chained audit log gives tamper evidence while remaining compatible with lawful erasure under Tanzania's Personal Data Protection Act — which an actual blockchain would not.

**Offline is the default assumption.** Every mutable record carries a version and timestamp. Dose reminders are precomputed as rows so a phone can fire them with no connectivity. Queued writes replay with their original idempotency keys.

---

## Getting started

### Prerequisites
- Node 22
- pnpm 10
- Docker (for PostgreSQL)

### Setup

```bash
pnpm install

# Start PostgreSQL
docker compose -f docker-compose.dev.yml up -d postgres

# Apply migrations
pnpm --filter @a-health/database exec prisma migrate deploy

# Run everything
docker compose -f docker-compose.dev.yml up --build
```

### Running a single service

```bash
pnpm --filter @a-health/consultation dev
```

### Verifying a service

```bash
pnpm --filter @a-health/consultation exec tsc --noEmit
pnpm --filter @a-health/consultation test
```

Both matter: the test runner strips types without checking them, so a green test suite does not by itself mean the service compiles.

### Contract

```bash
pnpm --filter @a-health/api lint      # validate the OpenAPI document
pnpm --filter @a-health/api generate  # regenerate TypeScript types
```

---

## Testing

Every service has integration tests running against a live development database, guarded so they refuse to run outside one. Continuous integration validates the contract, applies migrations, then type-checks and tests all 25 services in parallel.

---

## Status

The backend is feature-complete against the contract. Remaining work before production:

- Production Dockerfiles (the current compose file is development-only)
- Secrets management (`JWT_SECRET`, `GATEWAY_SHARED_SECRET` are development placeholders)
- Live AI model deployment (15 models are registered with adapter slots; a rule-based fallback is active by default)
- Real telecom aggregator and mobile money provider credentials

---

## License

Proprietary — internal use only.
# A-HEALTH-PLATFORM
