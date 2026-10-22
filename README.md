# A-Health Platform

A-Health is a digital health platform for Tanzania. This repository brings the web applications, Flutter patient app, backend services, shared packages, database schema, migrations, and operating documentation into one pnpm workspace.

## Repository layout

| Path | Contents |
|---|---|
| `apps/staff-web` | Unified Next.js application for clinical and operational staff |
| `apps/patient-mobile` | Flutter patient application |
| `apps/admin`, `apps/doctor-admin`, `apps/analytics` | Administration and analytics applications |
| `services` | 25 independently runnable domain APIs and workers |
| `packages` | OpenAPI contract, Prisma schema and migrations, shared HTTP, config, logging, types, and utilities |
| `docs` | Architecture, clinical workflows, local setup, and release guidance |
| `verification` | Scoped safety and integration verification harnesses |

The [pre-consolidation Web README](docs/legacy/README-Web-pre-consolidation.md) is retained as historical reference; this file describes the unified workspace.

## Local development on Windows

Requirements: Node.js 22, pnpm 10.34.4, PostgreSQL 17 on the isolated local port `55432`, and Flutter for Patient Mobile.

```powershell
pnpm install --frozen-lockfile
.\scripts\configure-local.ps1
pnpm seed:local
pnpm dev:local
```

`configure-local.ps1` creates the ignored `.env` only when one is absent. Keep that file private. `seed:local` provisions synthetic development roles. The local launcher verifies that its database target is `ahealth_dev` on `127.0.0.1:55432`, applies pending migrations, and checks all 25 API health routes plus the four web login routes. It does not target PostgreSQL port `5432`.

| Application | Local URL |
|---|---|
| Staff Web | <http://localhost:3000/login> |
| Doctor Admin | <http://localhost:3100/login> |
| Operations Admin | <http://localhost:3200/login> |
| Analytics | <http://localhost:3300/login> |

See [Local Windows setup](docs/LOCAL-WINDOWS-SETUP.md) and the [local readiness report](docs/local-dev-readiness.md) for details.

## Database migrations

The Prisma migration directory contains 22 migrations. The integration adds the Digital Front Desk migration (`20261021090000_digital_front_desk`) and Care Continuity migration (`20261021130000_care_continuity`). They were exercised against the isolated local development database. Review and apply migrations through the normal deployment process before using another environment.

## Verification commands

```powershell
pnpm test:local
pnpm run build
pnpm --filter a-health-web run type-check
cd apps/patient-mobile
flutter test
```

`pnpm test:local` provisions isolated, uniquely named test schemas inside `ahealth_dev` and leaves them available for inspection. It refuses non-local database targets and port `5432`.

## Integration limits

Local SMS and mobile-money adapters use console simulations; AI and transcription use stubs. These checks do not validate production credentials, live telecom or payment delivery, deployment infrastructure, or clinical use. The browser preview under `demo-previews/` uses synthetic responses and is not a live application.
