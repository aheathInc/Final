# A-Health Platform — consolidated monorepo

This source is a **restructured candidate**, not a production-tested release.

## Layout

- `apps/staff-web/` — Next.js Staff Web (App Router in `app/`)
- `apps/patient-mobile/` — Flutter patient app
- `apps/admin/`, `apps/analytics/`, `apps/doctor-admin/` — additional existing web applications
- `services/` — backend services
- `packages/` — shared libraries, API contracts and Prisma migrations
- `docs/` — product/technical documentation
- `scripts/` — setup and acceptance scripts
- `verification/` — existing verification harness

## Commands (once toolchains and dependencies are available)

From repository root: `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm test`.

Staff Web: `cd apps/staff-web` (then use its package scripts).
Flutter: `cd apps/patient-mobile && flutter pub get && flutter test`.

## Caution

- This changes package paths and requires a fresh locked-install/build/Playwright/Flutter acceptance on a configured machine.
- Do not deploy or replace the active repository until those checks pass.
- No database migrations were applied. No original source archive was modified.
- UI/demo pending work is still separate and is **not** silently merged into this archive.
